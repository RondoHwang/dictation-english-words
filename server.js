const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DEV_MODE = (process.env.DEV_MODE || "true").toLowerCase() === "true";
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!JWT_SECRET || !ADMIN_SECRET) {
  console.error("  ✗ 缺少必要环境变量：JWT_SECRET 或 ADMIN_SECRET");
  process.exit(1);
}

const SMS_CONFIG = {
  secretId: process.env.SMS_SECRET_ID || "",
  secretKey: process.env.SMS_SECRET_KEY || "",
  sdkAppId: process.env.SMS_SDK_APP_ID || "",
  signName: process.env.SMS_SIGN_NAME || "",
  templateId: process.env.SMS_TEMPLATE_ID || "",
  region: process.env.SMS_REGION || "ap-guangzhou",
};

if (!DEV_MODE) {
  const requiredSmsKeys = [
    "secretId",
    "secretKey",
    "sdkAppId",
    "signName",
    "templateId",
  ];
  const missingSmsKeys = requiredSmsKeys.filter((k) => !SMS_CONFIG[k]);
  if (missingSmsKeys.length) {
    console.error(
      `  ✗ 非开发模式下缺少短信配置：${missingSmsKeys.join(", ")}`,
    );
    process.exit(1);
  }
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "dictation_app",
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
});

if (!process.env.DB_USER || process.env.DB_PASSWORD === undefined) {
  console.error("  ✗ 缺少数据库环境变量：DB_USER 或 DB_PASSWORD");
  process.exit(1);
}

let smsClient = null;
function getSmsClient() {
  if (smsClient) return smsClient;
  const tc = require("tencentcloud-sdk-nodejs-sms");
  smsClient = new tc.sms.v20210111.Client({
    credential: {
      secretId: SMS_CONFIG.secretId,
      secretKey: SMS_CONFIG.secretKey,
    },
    region: SMS_CONFIG.region,
  });
  return smsClient;
}

const codeStore = new Map();
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
async function sendSmsCode(phone, code) {
  if (DEV_MODE) {
    console.log(`  [DEV] 验证码 -> ${phone}: ${code}`);
    return;
  }
  await getSmsClient().SendSms({
    PhoneNumberSet: [`+86${phone}`],
    SmsSdkAppId: SMS_CONFIG.sdkAppId,
    SignName: SMS_CONFIG.signName,
    TemplateId: SMS_CONFIG.templateId,
    TemplateParamSet: [code, "5"],
  });
}

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_, f, cb) => cb(null, Date.now() + "-" + f.originalname),
});
const upload = multer({
  storage,
  fileFilter: (_, f, cb) => {
    cb(
      [".xlsx", ".xls"].includes(path.extname(f.originalname).toLowerCase())
        ? null
        : new Error("只支持 .xlsx / .xls"),
      true,
    );
  },
});

function authenticateUser(req, res, next) {
  const t = (req.headers["authorization"] || "").split(" ")[1];
  if (!t) return res.status(401).json({ error: "未登录" });
  try {
    const d = jwt.verify(t, JWT_SECRET);
    if (d.role === "admin")
      return res.status(403).json({ error: "请使用管理员接口" });
    req.userId = d.userId;
    next();
  } catch {
    return res.status(401).json({ error: "登录已过期" });
  }
}
function authenticateAdmin(req, res, next) {
  const t = (req.headers["authorization"] || "").split(" ")[1];
  if (!t) return res.status(401).json({ error: "未登录" });
  try {
    const d = jwt.verify(t, ADMIN_SECRET);
    if (d.role !== "admin")
      return res.status(403).json({ error: "无管理权限" });
    req.adminId = d.adminId;
    next();
  } catch {
    return res.status(401).json({ error: "登录已过期" });
  }
}

async function ensureDefaultAdmin() {
  try {
    const [r] = await pool.query("SELECT COUNT(*) AS c FROM admins");
    if (r[0].c === 0) {
      await pool.query("INSERT INTO admins(username,password) VALUES(?,?)", [
        "admin",
        await bcrypt.hash("admin123", 10),
      ]);
      console.log("  ✦ 默认管理员已创建 → admin / admin123");
    }
  } catch (e) {
    console.error("  ✗ 检查管理员失败:", e.message);
  }
}

/* ===================== 公开路由 ===================== */

app.post("/api/auth/send-code", async (req, res) => {
  try {
    const { phone, type } = req.body;
    if (!/^1[3-9]\d{9}$/.test(phone))
      return res.status(400).json({ error: "手机号格式不正确" });
    const ex = codeStore.get(phone);
    if (ex && Date.now() - ex.lastSentAt < 60000)
      return res.status(429).json({
        error: `${Math.ceil((60000 - (Date.now() - ex.lastSentAt)) / 1000)}秒后才能重新发送`,
      });
    if (type === "register") {
      const [u] = await pool.query("SELECT id FROM users WHERE phone=?", [
        phone,
      ]);
      if (u.length) return res.status(400).json({ error: "该手机号已注册" });
    }
    if (type === "login") {
      const [u] = await pool.query("SELECT id FROM users WHERE phone=?", [
        phone,
      ]);
      if (!u.length) return res.status(400).json({ error: "该手机号未注册" });
    }
    const code = DEV_MODE ? "123456" : generateCode();
    await sendSmsCode(phone, code);
    codeStore.set(phone, {
      code,
      expireAt: Date.now() + 300000,
      lastSentAt: Date.now(),
      attempts: 0,
    });
    res.json({
      success: true,
      message: DEV_MODE ? "开发模式，验证码为 123456" : "验证码已发送",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "发送失败" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { phone, code, nickname, password } = req.body;
    if (!/^1[3-9]\d{9}$/.test(phone))
      return res.status(400).json({ error: "手机号格式不正确" });
    if (!nickname?.trim()) return res.status(400).json({ error: "请输入昵称" });
    if (!password || password.length < 6)
      return res.status(400).json({ error: "密码至少6位" });
    const s = codeStore.get(phone);
    if (!s) return res.status(400).json({ error: "请先发送验证码" });
    if (Date.now() > s.expireAt) {
      codeStore.delete(phone);
      return res.status(400).json({ error: "验证码已过期" });
    }
    if (s.attempts >= 5) {
      codeStore.delete(phone);
      return res.status(400).json({ error: "错误次数过多" });
    }
    if (s.code !== code) {
      s.attempts++;
      return res.status(400).json({ error: "验证码错误" });
    }
    const [ex] = await conn.query("SELECT id FROM users WHERE phone=?", [
      phone,
    ]);
    if (ex.length) return res.status(400).json({ error: "该手机号已注册" });
    await conn.beginTransaction();
    const [r] = await conn.query(
      "INSERT INTO users(phone,nickname,password) VALUES(?,?,?)",
      [phone, nickname.trim(), await bcrypt.hash(password, 10)],
    );
    const uid = r.insertId;
    await conn.query("UPDATE words SET user_id=? WHERE user_id IS NULL", [uid]);
    await conn.query("UPDATE errors SET user_id=? WHERE user_id IS NULL", [
      uid,
    ]);
    await conn.query(
      "UPDATE dictation_sessions SET user_id=? WHERE user_id IS NULL",
      [uid],
    );
    await conn.commit();
    codeStore.delete(phone);
    res.json({
      success: true,
      token: jwt.sign({ userId: uid }, JWT_SECRET, { expiresIn: JWT_EXPIRES }),
      user: { id: uid, phone, nickname: nickname.trim(), last_book: "" },
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: "注册失败：" + e.message });
  } finally {
    conn.release();
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password)
      return res.status(400).json({ error: "请输入手机号和密码" });
    const [rows] = await pool.query("SELECT * FROM users WHERE phone=?", [
      phone,
    ]);
    if (!rows.length) return res.status(400).json({ error: "该手机号未注册" });
    if (!(await bcrypt.compare(password, rows[0].password)))
      return res.status(400).json({ error: "密码错误" });
    const u = rows[0];
    res.json({
      success: true,
      token: jwt.sign({ userId: u.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES }),
      user: {
        id: u.id,
        phone: u.phone,
        nickname: u.nickname,
        last_book: u.last_book || "",
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login-code", async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!/^1[3-9]\d{9}$/.test(phone))
      return res.status(400).json({ error: "手机号格式不正确" });
    const [rows] = await pool.query("SELECT * FROM users WHERE phone=?", [
      phone,
    ]);
    if (!rows.length) return res.status(400).json({ error: "该手机号未注册" });
    const s = codeStore.get(phone);
    if (!s) return res.status(400).json({ error: "请先发送验证码" });
    if (Date.now() > s.expireAt) {
      codeStore.delete(phone);
      return res.status(400).json({ error: "验证码已过期" });
    }
    if (s.attempts >= 5) {
      codeStore.delete(phone);
      return res.status(400).json({ error: "错误次数过多" });
    }
    if (s.code !== code) {
      s.attempts++;
      return res.status(400).json({ error: "验证码错误" });
    }
    codeStore.delete(phone);
    const u = rows[0];
    res.json({
      success: true,
      token: jwt.sign({ userId: u.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES }),
      user: {
        id: u.id,
        phone: u.phone,
        nickname: u.nickname,
        last_book: u.last_book || "",
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "请输入账号和密码" });
    const [rows] = await pool.query("SELECT * FROM admins WHERE username=?", [
      username,
    ]);
    if (!rows.length) return res.status(400).json({ error: "账号不存在" });
    if (!(await bcrypt.compare(password, rows[0].password)))
      return res.status(400).json({ error: "密码错误" });
    res.json({
      success: true,
      token: jwt.sign({ adminId: rows[0].id, role: "admin" }, ADMIN_SECRET, {
        expiresIn: "24h",
      }),
      admin: { id: rows[0].id, username: rows[0].username },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===================== 用户路由（需登录） ===================== */

// 仅对非公开、非管理员路由做认证
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/") || req.path.startsWith("/admin/"))
    return next();
  authenticateUser(req, res, next);
});

app.get("/api/auth/me", authenticateUser, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id,phone,nickname,last_book,created_at FROM users WHERE id=?",
      [req.userId],
    );
    rows.length
      ? res.json(rows[0])
      : res.status(404).json({ error: "用户不存在" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- 书本/单元 ----
app.get("/api/books", async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT book, COUNT(*) AS word_count FROM words WHERE user_id=? AND book!="" GROUP BY book ORDER BY MIN(created_at) DESC',
      [req.userId],
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/units", async (req, res) => {
  try {
    const { book } = req.query;
    if (!book) return res.json([]);
    const [rows] = await pool.query(
      "SELECT unit, COUNT(*) AS word_count FROM words WHERE user_id=? AND book=? GROUP BY unit ORDER BY MIN(created_at)",
      [req.userId, book],
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- 上传 ----
app.post("/api/upload/parse", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "请上传文件" });
    const wb = XLSX.readFile(req.file.path);
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    fs.unlink(req.file.path, () => {});
    const words = [],
      parseErrors = [];
    raw.forEach((row, i) => {
      const chinese = String(row["中文"] || row["chinese"] || "").trim();
      const phonetic = String(row["音标"] || row["phonetic"] || "").trim();
      const english = String(row["英文"] || row["english"] || "").trim();
      if (chinese && english) words.push({ chinese, phonetic, english });
      else if (chinese || english)
        parseErrors.push(`第${i + 2}行：缺少${!chinese ? "中文" : "英文"}`);
    });
    res.json({ success: true, words, parseErrors, totalRows: raw.length });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: "解析失败：" + err.message });
  }
});

app.post("/api/upload/confirm", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { words, book, unit } = req.body;
    if (!words?.length) return res.status(400).json({ error: "没有单词" });
    if (!book?.trim()) return res.status(400).json({ error: "请输入书本名称" });
    if (!unit?.trim()) return res.status(400).json({ error: "请输入单元" });
    await conn.beginTransaction();
    let inserted = 0,
      updated = 0;
    for (const w of words) {
      const [ex] = await conn.query(
        "SELECT id FROM words WHERE english=? AND user_id=? AND book=?",
        [w.english, req.userId, book.trim()],
      );
      if (ex.length) {
        await conn.query(
          "UPDATE words SET chinese=?,phonetic=?,unit=? WHERE english=? AND user_id=? AND book=?",
          [
            w.chinese,
            w.phonetic || "",
            unit.trim(),
            w.english,
            req.userId,
            book.trim(),
          ],
        );
        updated++;
      } else {
        await conn.query(
          "INSERT INTO words(user_id,chinese,phonetic,english,book,unit) VALUES(?,?,?,?,?,?)",
          [
            req.userId,
            w.chinese,
            w.phonetic || "",
            w.english,
            book.trim(),
            unit.trim(),
          ],
        );
        inserted++;
      }
    }
    await conn.commit();
    res.json({ success: true, inserted, updated, total: words.length });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: "上传失败：" + err.message });
  } finally {
    conn.release();
  }
});

// ---- 单词管理 ----
app.get("/api/words", async (req, res) => {
  try {
    const {
      book = "",
      unit = "",
      search = "",
      page = 1,
      pageSize = 30,
    } = req.query;
    const p = Math.max(1, +page),
      s = Math.min(200, Math.max(1, +pageSize));
    let where = "user_id=?",
      params = [req.userId];
    if (book) {
      where += " AND book=?";
      params.push(book);
    }
    if (unit && unit !== "__all__") {
      where += " AND unit=?";
      params.push(unit);
    }
    if (search.trim()) {
      where += " AND (chinese LIKE ? OR english LIKE ? OR phonetic LIKE ?)";
      params.push(
        `%${search.trim()}%`,
        `%${search.trim()}%`,
        `%${search.trim()}%`,
      );
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) total FROM words WHERE ${where}`,
      params,
    );
    const [words] = await pool.query(
      `SELECT * FROM words WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, s, (p - 1) * s],
    );
    res.json({ words, total, page: p, pageSize: s });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/words", async (req, res) => {
  try {
    const { chinese, phonetic, english, book, unit } = req.body;
    if (!chinese?.trim() || !english?.trim())
      return res.status(400).json({ error: "中文和英文不能为空" });
    if (!book?.trim()) return res.status(400).json({ error: "请输入书本" });
    if (!unit?.trim()) return res.status(400).json({ error: "请输入单元" });
    const [dup] = await pool.query(
      "SELECT id FROM words WHERE english=? AND user_id=? AND book=?",
      [english.trim(), req.userId, book.trim()],
    );
    if (dup.length)
      return res.status(400).json({ error: "该书本中已存在相同英文单词" });
    await pool.query(
      "INSERT INTO words(user_id,chinese,phonetic,english,book,unit) VALUES(?,?,?,?,?,?)",
      [
        req.userId,
        chinese.trim(),
        phonetic?.trim() || "",
        english.trim(),
        book.trim(),
        unit.trim(),
      ],
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/words/:id", async (req, res) => {
  try {
    const { chinese, phonetic, english, book, unit } = req.body;
    if (!chinese?.trim() || !english?.trim())
      return res.status(400).json({ error: "中文和英文不能为空" });
    const [dup] = await pool.query(
      "SELECT id FROM words WHERE english=? AND id!=? AND user_id=? AND book=?",
      [english, +req.params.id, req.userId, book || ""],
    );
    if (dup.length)
      return res.status(400).json({ error: "该书本中已存在相同英文单词" });
    const [r] = await pool.query(
      "UPDATE words SET chinese=?,phonetic=?,english=?,book=?,unit=? WHERE id=? AND user_id=?",
      [
        chinese.trim(),
        phonetic?.trim() || "",
        english.trim(),
        book || "",
        unit || "",
        +req.params.id,
        req.userId,
      ],
    );
    r.affectedRows
      ? res.json({ success: true })
      : res.status(404).json({ error: "单词不存在" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/words/:id", async (req, res) => {
  try {
    const [r] = await pool.query("DELETE FROM words WHERE id=? AND user_id=?", [
      +req.params.id,
      req.userId,
    ]);
    r.affectedRows
      ? res.json({ success: true })
      : res.status(404).json({ error: "单词不存在" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- 听写 ----
app.post("/api/dictation/select", async (req, res) => {
  try {
    const { book, unit, count = 30, mode = "normal" } = req.body;
    const limit = Math.max(1, Math.min(100, +count));

    // 记住书本
    if (book && book !== "__all__") {
      await pool
        .query("UPDATE users SET last_book=? WHERE id=?", [book, req.userId])
        .catch(() => {});
    }

    let sql,
      params = [req.userId];
    if (mode === "error_book") {
      sql = `SELECT w.id,w.chinese,w.phonetic,w.english,w.book,w.unit,e.error_count,e.consecutive_correct
                   FROM errors e JOIN words w ON e.word_id=w.id WHERE e.is_active=1 AND w.user_id=?`;
    } else {
      sql =
        "SELECT id,chinese,phonetic,english,book,unit,dictation_count FROM words WHERE user_id=?";
    }
    if (book && book !== "__all__") {
      sql += ` AND ${mode === "error_book" ? "w." : ""}book=?`;
      params.push(book);
    }
    if (unit && unit !== "__all__") {
      sql += ` AND ${mode === "error_book" ? "w." : ""}unit=?`;
      params.push(unit);
    }
    sql +=
      mode === "error_book"
        ? " ORDER BY e.error_count DESC, RAND()"
        : " ORDER BY dictation_count ASC, RAND()";
    sql += " LIMIT ?";
    params.push(limit);
    res.json((await pool.query(sql, params))[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/dictation/submit", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { book, unit, mode, timeSpent, results } = req.body;
    if (!results?.length) return res.status(400).json({ error: "没有结果" });
    await conn.beginTransaction();
    const correct = results.filter((r) => r.isCorrect).length,
      wrong = results.length - correct;
    const [sr] = await conn.query(
      "INSERT INTO dictation_sessions(user_id,book,unit,mode,word_count,time_spent,correct_count,wrong_count) VALUES(?,?,?,?,?,?,?,?)",
      [
        req.userId,
        book || "",
        unit || "",
        mode || "normal",
        results.length,
        timeSpent || 0,
        correct,
        wrong,
      ],
    );
    const sid = sr.insertId;
    for (const r of results) {
      await conn.query(
        "INSERT INTO dictation_records(session_id,word_id,is_correct) VALUES(?,?,?)",
        [sid, r.wordId, r.isCorrect ? 1 : 0],
      );
      await conn.query(
        "UPDATE words SET dictation_count=dictation_count+1 WHERE id=? AND user_id=?",
        [r.wordId, req.userId],
      );
      if (r.isCorrect) {
        const [er] = await conn.query(
          "SELECT id,consecutive_correct FROM errors WHERE word_id=? AND user_id=? AND is_active=1",
          [r.wordId, req.userId],
        );
        if (er.length) {
          const nc = er[0].consecutive_correct + 1;
          await conn.query(
            "UPDATE errors SET consecutive_correct=?,is_active=? WHERE id=?",
            [nc, nc >= 3 ? 0 : 1, er[0].id],
          );
        }
      } else {
        const [er] = await conn.query(
          "SELECT id FROM errors WHERE word_id=? AND user_id=?",
          [r.wordId, req.userId],
        );
        if (er.length) {
          await conn.query(
            "UPDATE errors SET error_count=error_count+1,consecutive_correct=0,is_active=1 WHERE id=?",
            [er[0].id],
          );
        } else {
          await conn.query(
            "INSERT INTO errors(user_id,word_id,error_count,consecutive_correct,is_active) VALUES(?,?,1,0,1)",
            [req.userId, r.wordId],
          );
        }
      }
    }
    await conn.commit();
    res.json({
      success: true,
      sessionId: sid,
      correctCount: correct,
      wrongCount: wrong,
      accuracy: ((correct / results.length) * 100).toFixed(1),
      timeSpent: timeSpent || 0,
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

app.get("/api/error-books", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT w.book, COUNT(*) AS word_count
             FROM errors e JOIN words w ON e.word_id=w.id
             WHERE e.is_active=1 AND w.user_id=? AND w.book!=''
             GROUP BY w.book ORDER BY MIN(w.created_at) DESC`,
      [req.userId],
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/error-units", async (req, res) => {
  try {
    const { book } = req.query;
    if (!book) return res.json([]);
    const [rows] = await pool.query(
      `SELECT w.unit, COUNT(*) AS word_count
             FROM errors e JOIN words w ON e.word_id=w.id
             WHERE e.is_active=1 AND w.user_id=? AND w.book=?
             GROUP BY w.unit ORDER BY MIN(w.created_at)`,
      [req.userId, book],
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- 错题本 ----
app.get("/api/errors", async (req, res) => {
  try {
    const { book = "", unit = "", search = "" } = req.query;
    let sql = `SELECT w.id,w.chinese,w.phonetic,w.english,w.book,w.unit,e.error_count,e.consecutive_correct
                   FROM errors e JOIN words w ON e.word_id=w.id WHERE e.is_active=1 AND w.user_id=?`;
    const p = [req.userId];
    if (book) {
      sql += " AND w.book=?";
      p.push(book);
    }
    if (unit && unit !== "__all__") {
      sql += " AND w.unit=?";
      p.push(unit);
    }
    if (search.trim()) {
      sql += " AND (w.chinese LIKE ? OR w.english LIKE ? OR w.phonetic LIKE ?)";
      p.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }
    sql += " ORDER BY e.error_count DESC";
    res.json((await pool.query(sql, p))[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- 听写记录 ----
app.get("/api/history", async (req, res) => {
  try {
    res.json(
      (
        await pool.query(
          "SELECT * FROM dictation_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
          [req.userId],
        )
      )[0],
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/history/:id", async (req, res) => {
  try {
    const [sess] = await pool.query(
      "SELECT * FROM dictation_sessions WHERE id=? AND user_id=?",
      [+req.params.id, req.userId],
    );
    if (!sess.length) return res.status(404).json({ error: "记录不存在" });
    const [records] = await pool.query(
      `SELECT dr.is_correct,w.chinese,w.phonetic,w.english,w.book,w.unit FROM dictation_records dr JOIN words w ON dr.word_id=w.id WHERE dr.session_id=?`,
      [+req.params.id],
    );
    res.json({ session: sess[0], records });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- 统计 ----
app.get("/api/stats", async (req, res) => {
  try {
    const [[w]] = await pool.query(
      "SELECT COUNT(*) c FROM words WHERE user_id=?",
      [req.userId],
    );
    const [[e]] = await pool.query(
      "SELECT COUNT(*) c FROM errors e JOIN words w ON e.word_id=w.id WHERE e.is_active=1 AND w.user_id=?",
      [req.userId],
    );
    const [[s]] = await pool.query(
      "SELECT COUNT(*) c FROM dictation_sessions WHERE user_id=?",
      [req.userId],
    );
    const [[b]] = await pool.query(
      "SELECT COUNT(DISTINCT book) c FROM words WHERE user_id=?",
      [req.userId],
    );
    res.json({
      totalWords: w.c,
      activeErrors: e.c,
      totalSessions: s.c,
      totalBooks: b.c,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===================== 管理员路由 ===================== */

app.get("/api/admin/me", authenticateAdmin, async (req, res) => {
  try {
    const [r] = await pool.query(
      "SELECT id,username,created_at FROM admins WHERE id=?",
      [req.adminId],
    );
    r.length ? res.json(r[0]) : res.status(404).json({ error: "管理员不存在" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/stats", authenticateAdmin, async (req, res) => {
  try {
    const [[u]] = await pool.query("SELECT COUNT(*) c FROM users");
    const [[w]] = await pool.query("SELECT COUNT(*) c FROM words");
    const [[s]] = await pool.query("SELECT COUNT(*) c FROM dictation_sessions");
    const [[t]] = await pool.query(
      "SELECT COALESCE(SUM(time_spent),0) c FROM dictation_sessions",
    );
    res.json({
      totalUsers: u.c,
      totalWords: w.c,
      totalSessions: s.c,
      totalTime: t.c,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/users", authenticateAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
            SELECT u.id,u.phone,u.nickname,u.created_at,
                (SELECT COUNT(*) FROM words WHERE user_id=u.id) AS word_count,
                (SELECT COUNT(DISTINCT book) FROM words WHERE user_id=u.id) AS book_count,
                (SELECT COUNT(*) FROM dictation_sessions WHERE user_id=u.id) AS session_count,
                (SELECT COALESCE(SUM(time_spent),0) FROM dictation_sessions WHERE user_id=u.id) AS total_time,
                (SELECT COALESCE(ROUND(AVG(correct_count*100.0/word_count),1),0) FROM dictation_sessions WHERE user_id=u.id AND word_count>0) AS avg_accuracy,
                (SELECT COUNT(*) FROM errors e JOIN words w ON e.word_id=w.id WHERE w.user_id=u.id AND e.is_active=1) AS error_count,
                (SELECT MAX(created_at) FROM dictation_sessions WHERE user_id=u.id) AS last_active
            FROM users u ORDER BY u.created_at DESC`);
    const { search = "" } = req.query;
    if (!search.trim()) return res.json(rows);
    const kw = search.trim().toLowerCase();
    res.json(
      rows.filter(
        (r) =>
          r.phone.includes(kw) || (r.nickname || "").toLowerCase().includes(kw),
      ),
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/users/:id", authenticateAdmin, async (req, res) => {
  try {
    const uid = +req.params.id;
    const [[user]] = await pool.query(
      "SELECT id,phone,nickname,last_book,created_at FROM users WHERE id=?",
      [uid],
    );
    if (!user) return res.status(404).json({ error: "用户不存在" });
    const [books] = await pool.query(
      "SELECT book,unit,COUNT(*) AS word_count,COALESCE(SUM(dictation_count),0) AS total_dictations FROM words WHERE user_id=? GROUP BY book,unit ORDER BY book,unit",
      [uid],
    );
    const [sessions] = await pool.query(
      "SELECT * FROM dictation_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 10",
      [uid],
    );
    const [[errors]] = await pool.query(
      "SELECT COUNT(*) c FROM errors e JOIN words w ON e.word_id=w.id WHERE w.user_id=? AND e.is_active=1",
      [uid],
    );
    res.json({ user, books, sessions, activeErrors: errors.c });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/admin/users/:id", authenticateAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const uid = +req.params.id;
    await conn.beginTransaction();
    await conn.query("DELETE FROM errors WHERE user_id=?", [uid]);
    await conn.query(
      "DELETE FROM dictation_records WHERE session_id IN (SELECT id FROM dictation_sessions WHERE user_id=?)",
      [uid],
    );
    await conn.query("DELETE FROM dictation_sessions WHERE user_id=?", [uid]);
    await conn.query("DELETE FROM words WHERE user_id=?", [uid]);
    const [r] = await conn.query("DELETE FROM users WHERE id=?", [uid]);
    await conn.commit();
    r.affectedRows
      ? res.json({ success: true })
      : res.status(404).json({ error: "用户不存在" });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

/* ====== 启动 ====== */
app.listen(PORT, async () => {
  await ensureDefaultAdmin();
  console.log(`\n  ✦ 英语听写助手已启动`);
  console.log(`  ✦ http://localhost:${PORT}`);
  console.log(`  ✦ 开发模式: ${DEV_MODE ? "开启 (验证码 123456)" : "关闭"}\n`);
});

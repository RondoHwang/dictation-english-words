-- ============================================
-- 听写助手 - 完整数据库初始化脚本
-- 适用于全新安装
-- ============================================

CREATE DATABASE IF NOT EXISTS dictation_app
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE dictation_app;

-- -------------------------------------------
-- 管理员表
-- -------------------------------------------
DROP TABLE IF EXISTS dictation_records;
DROP TABLE IF EXISTS dictation_sessions;
DROP TABLE IF EXISTS errors;
DROP TABLE IF EXISTS words;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS admins;

CREATE TABLE admins (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL,
    password      VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 默认管理员：admin / admin123
-- 密码由 server.js 启动时自动生成，此处不硬编码哈希

-- -------------------------------------------
-- 用户表
-- -------------------------------------------
CREATE TABLE users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    phone         VARCHAR(20)  NOT NULL,
    nickname      VARCHAR(50)  NOT NULL DEFAULT '',
    last_book     VARCHAR(100) DEFAULT '',
    password      VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------
-- 单词表
-- -------------------------------------------
CREATE TABLE words (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT DEFAULT NULL,
    chinese         VARCHAR(255) NOT NULL,
    phonetic        VARCHAR(255) DEFAULT '',
    english         VARCHAR(255) NOT NULL,
    book            VARCHAR(100) NOT NULL DEFAULT '',
    unit            VARCHAR(100) NOT NULL DEFAULT '',
    dictation_count INT DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_en_user_book (english, user_id, book),
    KEY idx_user  (user_id),
    KEY idx_book  (book),
    KEY idx_count (dictation_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------
-- 错题表
-- -------------------------------------------
CREATE TABLE errors (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    user_id             INT DEFAULT NULL,
    word_id             INT NOT NULL,
    error_count         INT DEFAULT 0,
    consecutive_correct INT DEFAULT 0,
    is_active           TINYINT(1) DEFAULT 1,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_word (word_id),
    KEY idx_user (user_id),
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------
-- 听写场次表
-- -------------------------------------------
CREATE TABLE dictation_sessions (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT DEFAULT NULL,
    book          VARCHAR(100) DEFAULT '',
    unit          VARCHAR(100) DEFAULT '',
    mode          VARCHAR(20)  DEFAULT 'normal',
    word_count    INT DEFAULT 0,
    time_spent    INT DEFAULT 0,
    correct_count INT DEFAULT 0,
    wrong_count   INT DEFAULT 0,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------
-- 听写记录表（每次听写的每个单词）
-- -------------------------------------------
CREATE TABLE dictation_records (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    word_id    INT NOT NULL,
    is_correct TINYINT(1) DEFAULT 1,
    FOREIGN KEY (session_id) REFERENCES dictation_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id)    REFERENCES words(id) ON DELETE CASCADE,
    KEY idx_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
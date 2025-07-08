# Discord PDF Bot

自動下載PDF並將內容發布到Discord頻道的機器人。

## 功能

- 每週五中午12點自動執行
- 從指定網站下載PDF文件
- 提取PDF文字內容
- 將內容發布到指定的Discord頻道
- 支援手動觸發（使用 `!pdf` 指令）

## 設定步驟

### 1. 創建Discord機器人

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 點擊 "New Application"
3. 給應用程式命名
4. 前往 "Bot" 頁面
5. 點擊 "Add Bot"
6. 複製 Token（這就是你的 `DISCORD_TOKEN`）

### 2. 設定機器人權限

在 "OAuth2" > "URL Generator" 頁面：
- Scopes: 選擇 `bot`
- Bot Permissions: 選擇 `Send Messages`, `View Channels`

### 3. 邀請機器人到伺服器

使用生成的URL邀請機器人到你的Discord伺服器。

### 4. 獲取頻道ID

1. 在Discord中啟用開發者模式（User Settings > Advanced > Developer Mode）
2. 右鍵點擊目標頻道
3. 選擇 "Copy ID"

### 5. 環境變數設定

在Railway或本地環境中設定以下環境變數：

```
DISCORD_TOKEN=your_discord_bot_token_here
CHANNEL_ID=your_discord_channel_id_here
```

## 本地開發

```bash
# 安裝依賴
npm install

# 創建 .env 文件
cp .env.example .env

# 編輯 .env 文件，填入你的Token和頻道ID

# 啟動開發模式
npm run dev
```

## Railway部署

1. 將代碼推送到GitHub
2. 在Railway中連接你的GitHub倉庫
3. 在Railway中設定環境變數：
   - `DISCORD_TOKEN`
   - `CHANNEL_ID`
4. 部署完成

## 使用說明

- 機器人會在每週五中午12點（台灣時間）自動執行
- 也可以在指定頻道中發送 `!pdf` 來手動觸發
- 機器人會自動分割長文本以避免Discord的字符限制

## 注意事項

- 確保機器人有足夠的權限在目標頻道中發送訊息
- PDF下載可能需要一些時間，請耐心等待
- 如果網站結構改變，可能需要調整PDF連結的抓取邏輯

## 故障排除

如果機器人無法正常工作：

1. 檢查Token是否正確
2. 確認頻道ID是否正確
3. 檢查機器人是否有適當的權限
4. 查看控制台日誌以獲取錯誤信息

## 技術細節

- 使用 `discord.js` 進行Discord API交互
- 使用 `cheerio` 進行網頁解析
- 使用 `pdf-parse` 進行PDF文字提取
- 使用 `node-cron` 進行定時任務排程
- 使用 `axios` 進行HTTP請求# Central-Kitchen

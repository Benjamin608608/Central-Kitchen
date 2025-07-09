const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const pdf = require('pdf-parse');
const cron = require('node-cron');

// 環境變數設定
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const TARGET_URL = 'https://www.blessing.org.tw/%E4%B8%AD%E5%A4%AE%E5%BB%9A%E6%88%BF';

// 創建Discord客戶端
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 下載PDF的函數
async function downloadPDF(pdfUrl) {
    try {
        console.log('開始下載PDF:', pdfUrl);
        const response = await axios({
            method: 'GET',
            url: pdfUrl,
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        console.log('PDF下載完成，大小:', response.data.byteLength, 'bytes');
        return Buffer.from(response.data);
    } catch (error) {
        console.error('下載PDF失敗:', error.message);
        throw error;
    }
}

// 從網站獲取PDF連結
async function getPDFLink() {
    try {
        console.log('開始獲取PDF連結...');
        const response = await axios.get(TARGET_URL, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        let pdfLink = null;
        
        // 方法1: 尋找href包含.pdf的連結
        $('a[href*=".pdf"]').each((index, element) => {
            const href = $(element).attr('href');
            if (href) {
                pdfLink = href.startsWith('http') ? href : new URL(href, TARGET_URL).href;
                console.log('找到PDF連結 (方法1):', pdfLink);
                return false; // 找到第一個就停止
            }
        });
        
        // 方法2: 如果沒找到，嘗試尋找可能的PDF連結
        if (!pdfLink) {
            $('a').each((index, element) => {
                const href = $(element).attr('href');
                const text = $(element).text().toLowerCase();
                if (href && (text.includes('pdf') || text.includes('菜單') || text.includes('餐點') || text.includes('menu'))) {
                    pdfLink = href.startsWith('http') ? href : new URL(href, TARGET_URL).href;
                    console.log('找到PDF連結 (方法2):', pdfLink);
                    return false;
                }
            });
        }
        
        // 方法3: 尋找可能的檔案連結
        if (!pdfLink) {
            $('a').each((index, element) => {
                const href = $(element).attr('href');
                if (href && (href.includes('.pdf') || href.includes('download') || href.includes('file'))) {
                    pdfLink = href.startsWith('http') ? href : new URL(href, TARGET_URL).href;
                    console.log('找到PDF連結 (方法3):', pdfLink);
                    return false;
                }
            });
        }
        
        return pdfLink;
    } catch (error) {
        console.error('獲取PDF連結失敗:', error.message);
        throw error;
    }
}

// 從PDF提取文字
async function extractTextFromPDF(pdfBuffer) {
    try {
        console.log('開始提取PDF文字...');
        const data = await pdf(pdfBuffer, {
            max: 0, // 最大頁數，0表示不限制
            version: 'v1.10.100' // 指定pdf2pic版本
        });
        
        console.log('PDF文字提取完成，字數:', data.text.length);
        return data.text;
    } catch (error) {
        console.error('PDF文字提取失敗:', error.message);
        throw error;
    }
}

// 從PDF內容中提取日期
function extractDateFromPDF(text) {
    console.log('開始從PDF內容提取日期...');
    
    // 常見的日期格式匹配
    const datePatterns = [
        // 2024年7月9日 星期二
        /(\d{4})年(\d{1,2})月(\d{1,2})日\s*([星期週][一二三四五六日天])?/,
        // 2024/7/9 週二
        /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*([週星期][一二三四五六日天])?/,
        // 7月9日星期二
        /(\d{1,2})月(\d{1,2})日\s*([星期週][一二三四五六日天])/,
        // 113年7月9日 (民國年)
        /(\d{2,3})年(\d{1,2})月(\d{1,2})日/,
        // 07-09 或 7-9
        /(\d{1,2})-(\d{1,2})/,
        // July 9, 2024 或 9 July 2024
        /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i,
        // 9 Jul 2024
        /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i
    ];
    
    // 在PDF文字的前幾行中尋找日期
    const lines = text.split('\n').slice(0, 10); // 只搜索前10行
    
    for (const line of lines) {
        console.log('檢查行:', line.trim());
        
        for (const pattern of datePatterns) {
            const match = line.match(pattern);
            if (match) {
                console.log('找到日期匹配:', match[0]);
                
                try {
                    let year, month, day, weekday;
                    
                    if (pattern.toString().includes('年.*月.*日')) {
                        // 中文格式: 2024年7月9日
                        year = parseInt(match[1]);
                        month = parseInt(match[2]);
                        day = parseInt(match[3]);
                        weekday = match[4] || '';
                        
                        // 處理民國年
                        if (year < 1000) {
                            year += 1911; // 民國年轉西元年
                        }
                    } else if (pattern.toString().includes('[\/\\-]')) {
                        // 斜線格式: 2024/7/9
                        year = parseInt(match[1]);
                        month = parseInt(match[2]);
                        day = parseInt(match[3]);
                        weekday = match[4] || '';
                    } else if (pattern.toString().includes('month.*day')) {
                        // 只有月日: 7月9日
                        const currentYear = new Date().getFullYear();
                        year = currentYear;
                        month = parseInt(match[1]);
                        day = parseInt(match[2]);
                        weekday = match[3] || '';
                    }
                    
                    if (year && month && day) {
                        const extractedDate = new Date(year, month - 1, day);
                        
                        // 驗證日期是否合理（不能太舊或太新）
                        const now = new Date();
                        const diffDays = Math.abs((extractedDate - now) / (1000 * 60 * 60 * 24));
                        
                        if (diffDays <= 30) { // 30天內的日期才認為有效
                            console.log('成功提取日期:', extractedDate);
                            return { date: extractedDate, originalText: match[0], weekday };
                        }
                    }
                } catch (error) {
                    console.log('日期解析錯誤:', error.message);
                    continue;
                }
            }
        }
    }
    
    console.log('無法從PDF中提取有效日期，使用當前日期');
    return null;
}

// 格式化日期為中文
function formatChineseDate(date, weekday = '') {
    const options = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
    };
    
    let dateString = date.toLocaleDateString('zh-TW', options);
    
    // 如果PDF中有星期資訊，優先使用PDF中的
    if (weekday) {
        dateString = dateString.replace(/星期[一二三四五六日天]/, weekday);
    }
    
    return dateString;
}

// 清理和格式化文字
function formatText(text) {
    return text
        .replace(/\s+/g, ' ') // 多個空白字符替換為單個空格
        .replace(/\n\s*\n/g, '\n') // 多個換行替換為單個換行
        .trim();
}

// 將長文本分割成多個訊息
function splitMessage(text, maxLength = 1900) {
    const messages = [];
    let currentMessage = '';
    
    const lines = text.split('\n');
    
    for (const line of lines) {
        if (currentMessage.length + line.length + 1 > maxLength) {
            if (currentMessage.trim()) {
                messages.push(currentMessage.trim());
            }
            currentMessage = line;
        } else {
            currentMessage += (currentMessage ? '\n' : '') + line;
        }
    }
    
    if (currentMessage.trim()) {
        messages.push(currentMessage.trim());
    }
    
    return messages;
}

// 主要功能函數
async function fetchAndPostPDF() {
    try {
        console.log('開始執行PDF下載與發布任務...');
        
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) {
            console.error('找不到指定的頻道');
            return;
        }
        
        // 發送開始訊息
        await channel.send('🔄 開始下載並處理PDF文件...');
        
        // 獲取PDF連結
        const pdfLink = await getPDFLink();
        if (!pdfLink) {
            await channel.send('❌ 無法找到PDF連結');
            return;
        }
        
        console.log('找到PDF連結:', pdfLink);
        
        // 下載PDF
        const pdfBuffer = await downloadPDF(pdfLink);
        
        // 提取文字
        const rawText = await extractTextFromPDF(pdfBuffer);
        const formattedText = formatText(rawText);
        
        if (!formattedText.trim()) {
            await channel.send('❌ PDF文字提取失敗或內容為空');
            return;
        }
        
        // 從PDF內容提取日期
        const extractedDateInfo = extractDateFromPDF(rawText);
        let dateString;
        
        if (extractedDateInfo) {
            dateString = formatChineseDate(extractedDateInfo.date, extractedDateInfo.weekday);
            console.log('使用PDF中的日期:', dateString);
        } else {
            // 如果無法提取，使用當前日期
            const now = new Date();
            dateString = formatChineseDate(now);
            console.log('使用當前日期:', dateString);
        }
        
        // 發送標題訊息（使用提取的日期）
        await channel.send(`📄 **${dateString} 中央廚房菜單**\n🔗 原始連結: ${pdfLink}\n\n**📋 菜單內容:**`);
        
        // 分割並發送文字內容
        const messages = splitMessage(formattedText);
        
        for (let i = 0; i < messages.length; i++) {
            await channel.send(`\`\`\`\n${messages[i]}\n\`\`\``);
            
            // 避免觸發Discord的速率限制
            if (i < messages.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        await channel.send('✅ PDF內容發布完成！');
        console.log('PDF內容發布完成');
        
    } catch (error) {
        console.error('執行任務時發生錯誤:', error);
        
        try {
            const channel = await client.channels.fetch(CHANNEL_ID);
            await channel.send(`❌ 執行任務時發生錯誤: ${error.message}`);
        } catch (channelError) {
            console.error('發送錯誤訊息失敗:', channelError);
        }
    }
}

// Discord機器人事件
client.once('ready', () => {
    console.log(`機器人已登入: ${client.user.tag}`);
    console.log(`監控頻道ID: ${CHANNEL_ID}`);
    console.log(`目標網站: ${TARGET_URL}`);
    
    // 設定每週五中午12點執行
    // 分 時 日 月 週
    cron.schedule('0 12 * * 5', () => {
        console.log('定時任務觸發 - 每週五中午12點');
        fetchAndPostPDF();
    }, {
        timezone: 'Asia/Taipei'
    });
    
    console.log('已設定定時任務: 每週五中午12點 (台北時間)');
    console.log('機器人啟動成功，所有功能已就緒！');
});

// 添加手動觸發指令
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // 手動觸發PDF下載
    if (message.content === '!pdf' && message.channelId === CHANNEL_ID) {
        await message.reply('🔄 開始手動執行PDF下載任務...');
        await fetchAndPostPDF();
    }
    
    // 測試指令
    if (message.content === '!test' && message.channelId === CHANNEL_ID) {
        await message.reply('✅ 機器人正常運作中！');
    }
    
    // 幫助指令
    if (message.content === '!help' && message.channelId === CHANNEL_ID) {
        await message.reply(`
📖 **可用指令：**
• \`!pdf\` - 手動下載並發布PDF
• \`!test\` - 測試機器人狀態
• \`!help\` - 顯示此幫助訊息

⏰ **自動執行：**
• 每週五中午12點自動下載並發布PDF

🔍 **新功能：**
• 自動從PDF內容中提取實際日期作為標題
        `);
    }
});

// 錯誤處理
client.on('error', (error) => {
    console.error('Discord客戶端錯誤:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('未處理的Promise拒絕:', error);
});

process.on('uncaughtException', (error) => {
    console.error('未捕獲的異常:', error);
});

// 優雅關閉
process.on('SIGINT', () => {
    console.log('收到SIGINT信號，正在關閉機器人...');
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('收到SIGTERM信號，正在關閉機器人...');
    client.destroy();
    process.exit(0);
});

// 登入Discord
client.login(DISCORD_TOKEN);

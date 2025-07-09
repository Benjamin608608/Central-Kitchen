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

// 計算前一個週日的日期
function getPreviousSunday() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=星期日, 1=星期一, ..., 6=星期六
    
    // 如果今天是星期日，回推7天到上個星期日
    // 如果今天是星期一，回推1天到昨天的星期日
    // 如果今天是星期二，回推2天到前天的星期日
    // 以此類推...
    const daysToSubtract = dayOfWeek === 0 ? 7 : dayOfWeek;
    
    const previousSunday = new Date(now);
    previousSunday.setDate(now.getDate() - daysToSubtract);
    
    console.log('今天是:', now.toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
    }));
    
    console.log('計算前一個週日:', previousSunday.toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
    }));
    
    return previousSunday;
}

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
            // PDF解析選項
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
        
        // 獲取PDF連結（移除開始訊息）
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
        
        // 使用前一個週日的日期作為標題
        const previousSunday = getPreviousSunday();
        const dateString = previousSunday.toLocaleDateString('zh-TW', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });
        
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
    
    // 測試連線
    console.log('機器人啟動成功，所有功能已就緒！');
});

// 添加手動觸發指令
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // 手動觸發PDF下載
    if (message.content === '!pdf' && message.channelId === CHANNEL_ID) {
        await fetchAndPostPDF();
    }
    
    // 測試指令
    if (message.content === '!test' && message.channelId === CHANNEL_ID) {
        await message.reply('✅ 機器人正常運作中！');
    }
    
    // 測試日期計算
    if (message.content === '!date' && message.channelId === CHANNEL_ID) {
        const previousSunday = getPreviousSunday();
        const dateString = previousSunday.toLocaleDateString('zh-TW', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });
        await message.reply(`📅 前一個週日是：${dateString}`);
    }
    
    // 幫助指令
    if (message.content === '!help' && message.channelId === CHANNEL_ID) {
        await message.reply(`
📖 **可用指令：**
• \`!pdf\` - 手動下載並發布PDF
• \`!test\` - 測試機器人狀態
• \`!date\` - 測試前一個週日日期計算
• \`!help\` - 顯示此幫助訊息

⏰ **自動執行：**
• 每週五中午12點自動下載並發布PDF

📅 **日期顯示：**
• 標題會自動顯示前一個週日的日期
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

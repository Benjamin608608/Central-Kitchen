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

// 改進的文字格式化，保留更多原始排版
function formatText(text) {
    // 首先進行基本清理，但保留更多原始結構
    let formatted = text
        .replace(/\r\n/g, '\n') // 統一換行符
        .replace(/\r/g, '\n')   // 統一換行符
        .replace(/\t/g, '    ') // 將tab轉換為4個空格
        .replace(/[ \u00A0]+$/gm, '') // 移除行尾空格
        .replace(/^\s*\n/gm, '\n') // 移除只有空格的行
        .trim();
    
    // 智能識別並加粗標題
    formatted = addBoldToTitles(formatted);
    
    // 保留表格結構和對齊
    formatted = preserveTableStructure(formatted);
    
    return formatted;
}

// 智能識別標題並加粗
function addBoldToTitles(text) {
    const lines = text.split('\n');
    const processedLines = [];
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const trimmedLine = line.trim();
        
        // 識別可能的標題模式
        const titlePatterns = [
            // 日期標題 (2024年7月9日, 7月9日等)
            /^(\d{4}年\d{1,2}月\d{1,2}日.*|^\d{1,2}月\d{1,2}日.*)/,
            // 餐次標題 (早餐、午餐、晚餐、點心等)
            /^(早餐|午餐|晚餐|點心|宵夜|下午茶).*$/,
            // 菜單、中央廚房等標題
            /^(菜單|中央廚房|餐點|食譜).*$/,
            // 短行且看起來像標題 (長度<20且包含中文)
            /^[\u4e00-\u9fff\s]{2,15}$/,
            // 全大寫英文標題
            /^[A-Z\s]{3,20}$/,
            // 數字開頭的項目 (1. 2. 3. 或 一、二、三、)
            /^(\d+[\.、]|[一二三四五六七八九十]+[、．])/
        ];
        
        let isTitle = false;
        
        // 檢查是否符合標題模式
        for (const pattern of titlePatterns) {
            if (pattern.test(trimmedLine)) {
                isTitle = true;
                break;
            }
        }
        
        // 額外的標題判斷邏輯
        if (!isTitle && trimmedLine.length > 0) {
            // 如果這行很短，下一行是空行或內容，可能是標題
            const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
            if (trimmedLine.length <= 20 && 
                (nextLine === '' || nextLine.length > trimmedLine.length) &&
                /[\u4e00-\u9fff]/.test(trimmedLine)) {
                isTitle = true;
            }
            
            // 如果前一行是空行，這行較短且包含中文，可能是標題
            const prevLine = i > 0 ? lines[i - 1].trim() : '';
            if (prevLine === '' && trimmedLine.length <= 25 && 
                /[\u4e00-\u9fff]/.test(trimmedLine) && 
                !/[\d]{2,}/.test(trimmedLine)) {
                isTitle = true;
            }
        }
        
        // 如果識別為標題且尚未加粗，則加粗
        if (isTitle && trimmedLine.length > 0 && !trimmedLine.includes('**')) {
            // 保留原始縮進
            const leadingSpaces = line.match(/^(\s*)/)[1];
            processedLines.push(leadingSpaces + '**' + trimmedLine + '**');
        } else {
            processedLines.push(line);
        }
    }
    
    return processedLines.join('\n');
}

// 保留表格結構和對齊
function preserveTableStructure(text) {
    const lines = text.split('\n');
    const processedLines = [];
    
    for (let line of lines) {
        // 檢測可能的表格行（包含多個空格分隔的項目）
        if (line.includes('  ') && line.trim().length > 0) {
            // 保留多個空格作為分隔符，但規範化為統一格式
            line = line.replace(/\s{2,}/g, '  '); // 多個空格統一為兩個空格
            
            // 如果看起來像表格頭部或分隔線，可能需要加粗
            const trimmed = line.trim();
            if (trimmed.includes('─') || trimmed.includes('═') || 
                trimmed.includes('|') || trimmed.includes('│')) {
                // 保留表格線條
                processedLines.push(line);
            } else if (trimmed.split(/\s{2,}/).length >= 3) {
                // 可能是表格數據行，保留原樣
                processedLines.push(line);
            } else {
                processedLines.push(line);
            }
        } else {
            processedLines.push(line);
        }
    }
    
    return processedLines.join('\n');
}

// 改進的文本分割，保留排版結構
function splitMessage(text, maxLength = 1900) {
    const messages = [];
    let currentMessage = '';
    
    const lines = text.split('\n');
    
    for (const line of lines) {
        // 計算加入這行後的長度
        const lineToAdd = currentMessage === '' ? line : '\n' + line;
        
        if (currentMessage.length + lineToAdd.length > maxLength) {
            // 如果當前消息不為空，保存它
            if (currentMessage.trim()) {
                messages.push(currentMessage.trim());
            }
            
            // 檢查單行是否超過限制
            if (line.length > maxLength) {
                // 單行太長，需要進一步分割，但盡量保持完整性
                const words = line.split(' ');
                let currentPart = '';
                
                for (const word of words) {
                    if (currentPart.length + word.length + 1 > maxLength) {
                        if (currentPart.trim()) {
                            messages.push(currentPart.trim());
                        }
                        currentPart = word;
                    } else {
                        currentPart += (currentPart === '' ? '' : ' ') + word;
                    }
                }
                
                if (currentPart.trim()) {
                    currentMessage = currentPart;
                } else {
                    currentMessage = '';
                }
            } else {
                currentMessage = line;
            }
        } else {
            currentMessage += lineToAdd;
        }
    }
    
    // 添加最後的消息
    if (currentMessage.trim()) {
        messages.push(currentMessage.trim());
    }
    
    return messages.length > 0 ? messages : ['無內容'];
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
        
        // 分割並發送文字內容（不使用代碼區塊）
        const messages = splitMessage(formattedText);
        
        for (let i = 0; i < messages.length; i++) {
            await channel.send(messages[i]);
            
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

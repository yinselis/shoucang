const context = SillyTavern.getContext();
const { eventSource, event_types, extensionSettings, SlashCommandParser, SlashCommand } = context;

const MODULE_NAME = 'global_bookmarks_pro';
const defaultSettings = {
    showFloatingButton: true,
    filterTags: 'think,summary',
    extractTags: '', // 新增：提取标签
    removeBeforeClosing: true,
    filterOnSave: true, // 保存时自动清洗标签
    bookmarks:[],
    fabPosition: { top: '30%', left: '85%' }
};

function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function getRealCharName(msg) {
    if (msg.is_user) return context.name1 || 'User';
    if (msg.name && msg.name !== 'SillyTavern System') return msg.name;
    return context.name2 || 'AI';
}

// ================= 【新增：提取标签逻辑】 =================
function applyTagExtraction(text) {
    if (!text) return text;
    const settings = extensionSettings[MODULE_NAME];
    const tags = (settings.extractTags || "").split(',').map(t => t.trim()).filter(t => t);
    
    // 如果没有设置提取标签，返回 null 表示不进行提取处理
    if (tags.length === 0) return null; 

    let extractedContent =[];
    tags.forEach(tag => {
        try {
            // 匹配 <tag>...</tag> 内的内容
            const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
            let match;
            while ((match = regex.exec(text)) !== null) {
                if (match[1]) extractedContent.push(match[1].trim());
            }
        } catch (e) { }
    });

    // 如果提取到了内容，拼起来返回；如果设定了提取但没找到，返回空字符串
    return extractedContent.length > 0 ? extractedContent.join('\n\n') : "";
}

function applyTagFilter(text) {
    if (!text) return text;
    let result = text;
    const settings = extensionSettings[MODULE_NAME];
    const tags = (settings.filterTags || "think").split(',').map(t => t.trim()).filter(t => t);
    
    tags.forEach(tag => {
        try {
            const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
            result = result.replace(regex, '');
        } catch (e) { }

        if (settings.removeBeforeClosing) {
            const closingTag = `</${tag}>`;
            const closingIndex = result.toLowerCase().indexOf(closingTag.toLowerCase());
            if (closingIndex !== -1) {
                result = result.substring(closingIndex + closingTag.length);
            } else {
                const openIndex = result.toLowerCase().indexOf(`<${tag}`.toLowerCase());
                if (openIndex !== -1) {
                    result = result.substring(0, openIndex);
                }
            }
        }
    });
    return result.trim();
}

function getRenderedHtml(text, forceOpen = false) {
    if (!text) return "";
    
    let magicBlocks =[];
    let tempText = text;
    const openAttr = forceOpen ? "open" : "";
    
    tempText = tempText.replace(/<!--([\s\S]*?)-->/g, function(match, p1) {
        magicBlocks.push(`&lt;!--${escapeHtml(p1)}--&gt;`);
        return `MAGICBLOCKPLACEHOLDER${magicBlocks.length - 1}ENDPLACEHOLDER`;
    });

    const tRegex = new RegExp('\\x3Cthink\\x3E([\\s\\S]*?)\\x3C/think\\x3E', 'gi');
    tempText = tempText.replace(tRegex, function(match, p1) {
        magicBlocks.push(`<details ${openAttr} style="border-left: 4px solid #cba6f7; background: rgba(203, 166, 247, 0.15); padding: 8px 12px; margin: 10px 0; border-radius: 0 8px 8px 0; font-size: 0.95em; color: var(--SmartThemeBodyColor); opacity: 0.9; text-align: left; display: block;">
<summary style="color: #cba6f7; font-weight: bold; font-family: monospace; user-select: none; cursor: pointer; outline: none;">&lt;think&gt; (点击展开思考过程)</summary>
<div style="margin-top: 8px; white-space: pre-wrap; font-family: inherit; border-top: 1px dashed rgba(203, 166, 247, 0.3); padding-top: 8px;">${escapeHtml(p1.trim())}</div></details>`);
        return `MAGICBLOCKPLACEHOLDER${magicBlocks.length - 1}ENDPLACEHOLDER`;
    });

    let html = "";
    if (typeof showdown !== 'undefined') {
        const converter = new showdown.Converter({ simpleLineBreaks: true });
        html = converter.makeHtml(tempText);
    } else {
        html = escapeHtml(tempText).replace(/\n/g, '<br>');
    }

    magicBlocks.forEach((block, index) => {
        let regexP = new RegExp(`<p>MAGICBLOCKPLACEHOLDER${index}ENDPLACEHOLDER<\\/p>`, 'g');
        let regexRaw = new RegExp(`MAGICBLOCKPLACEHOLDER${index}ENDPLACEHOLDER`, 'g');
        html = html.replace(regexP, block).replace(regexRaw, block);
    });

    return html;
}

function loadSettings() {
    if (!extensionSettings[MODULE_NAME]) extensionSettings[MODULE_NAME] = {};
    for (const key in defaultSettings) {
        if (extensionSettings[MODULE_NAME][key] === undefined) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
}

// ================= 【导回系统 (含插队功能)】 =================
async function restoreBookmarkToChat(bm) {
    try {
        const lastMessageId = context.chat.length - 1;
        let optionsHtml = `<div class="bkm-list-container"><h3 class="bkm-title">↩️ 请选择导回方式</h3><div class="bkm-flex-col">`;
        
        if (bm.floor !== undefined) {
            optionsHtml += `<button id="res-orig" class="bkm-btn highlight" style="font-weight:bold;">🔙 恢复到第 ${bm.floor} 楼 (作为新一页并立刻翻到这页)</button>`;
            optionsHtml += `<button id="res-orig-hidden" class="bkm-btn" style="color: #a6e3a1;">📖 悄悄塞入第 ${bm.floor} 楼 (作为新一页，但保持当前画面不动)</button>`;
        }
        optionsHtml += `<button id="res-new" class="bkm-btn">🆕 作为全新消息发送到聊天最末尾</button>`;
        optionsHtml += `<button id="res-insert" class="bkm-btn" style="color: #f9e2af;">⬇️ 强行插队 (作为新楼层插入到某楼之后)</button>`;
        optionsHtml += `<button id="res-swipe" class="bkm-btn">📖 作为隐藏分页塞入其他楼层</button>`;
        optionsHtml += `</div></div>`;

        const choice = await context.callGenericPopup(optionsHtml, context.POPUP_TYPE.TEXT, "", {
            okButton: false, cancelButton: "取消", allowVerticalScrolling: true,
            onOpen: async (popup) => {
                $('#res-orig').on('click', () => popup.complete(1));
                $('#res-orig-hidden').on('click', () => popup.complete(5));
                $('#res-new').on('click', () => popup.complete(2));
                $('#res-insert').on('click', () => popup.complete(4));
                $('#res-swipe').on('click', () => popup.complete(3));
            }
        });

        if (!choice || choice === context.POPUP_RESULT.CANCELLED) return;
        
        const safeText = bm.text || "*(内容丢失)*";
        const isUser = (bm.role || "").toLowerCase() === 'user' || bm.role === (context.name1 || "User");
        const bmCharName = isUser ? context.name1 : (bm.char || "AI");

        const createStandardMsg = () => ({
            name: bmCharName,
            is_user: isUser,
            is_name: !isUser,
            is_system: false,
            send_date: Date.now(),
            mes: safeText,
            extra: {},
            swipes: [safeText],
            swipe_id: 0,
            swipe_info:[{ send_date: Date.now(), extra: { bookmark_restored: true } }]
        });

        const appendNewMessage = async () => {
            const newMsg = createStandardMsg();
            context.chat.push(newMsg);
            if (typeof context.saveChat === 'function') await context.saveChat();
            if (typeof context.reloadCurrentChat === 'function') await context.reloadCurrentChat();
            if (typeof context.scrollChatToBottom === 'function') context.scrollChatToBottom();
        };

        const injectSwipeToFloor = async (targetFloor, switchToIt = true) => {
            const targetMsg = context.chat[targetFloor];
            if (!targetMsg) {
                toastr.error("❌ 找不到目标楼层！");
                return null;
            }

            if (!targetMsg.swipes || targetMsg.swipes.length === 0) {
                targetMsg.swipes = [targetMsg.mes || ""];
                targetMsg.swipe_info = [targetMsg.extra || {}];
                targetMsg.swipe_id = 0;
            }

            targetMsg.swipes.push(safeText);
            targetMsg.swipe_info.push({ send_date: Date.now(), extra: { bookmark_restored: true } });
            
            if (switchToIt) {
                targetMsg.swipe_id = targetMsg.swipes.length - 1;
                targetMsg.mes = safeText;
            }

            if (typeof context.saveChat === 'function') await context.saveChat();
            
            if (typeof context.reloadCurrentChat === 'function') {
                await context.reloadCurrentChat();
            } else if (typeof context.updateMessageBlock === 'function') {
                context.updateMessageBlock(targetFloor, targetMsg);
            }

            if (switchToIt) {
                setTimeout(() => {
                    const mesEl = $(`#chat .mes[mesid="${targetFloor}"]`);
                    if (mesEl.length > 0) mesEl[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 500);
            }

            return targetMsg;
        };

        if (choice === 1 || choice === 5) {
            const targetFloor = bm.floor;
            const switchToIt = (choice === 1);
            
            if (targetFloor > lastMessageId) {
                await appendNewMessage();
                toastr.success(`✅ 原楼层已不存在，已在末尾为您重新生成！`);
            } else {
                const updatedMsg = await injectSwipeToFloor(targetFloor, switchToIt);
                if (updatedMsg) {
                    if (switchToIt) toastr.success(`✅ 已恢复到第 ${targetFloor} 楼并切换至最新页！`);
                    else toastr.success(`✅ 已悄悄塞入第 ${targetFloor} 楼 (未替换当前画面)！`);
                }
            }
        } 
        else if (choice === 2) {
            await appendNewMessage();
            toastr.success(`✅ 已作为新消息追加到末尾！`);
        } 
        else if (choice === 3) {
            const input = await context.callGenericPopup(`请输入要塞入的楼层号 (0 - ${lastMessageId})：`, context.POPUP_TYPE.INPUT, "", { cancelButton: "取消" });
            if (!input) return;
            const tf = parseInt(input);
            if (isNaN(tf) || tf < 0 || tf > lastMessageId) return toastr.error(`❌ 无效的楼层号！`);
            const updatedMsg = await injectSwipeToFloor(tf, false); 
            if (updatedMsg) toastr.success(`✅ 已塞入第 ${tf} 楼！`);
        }
        else if (choice === 4) { 
            const input = await context.callGenericPopup(`请输入要在哪一楼【之后】插入 (0 - ${lastMessageId})：`, context.POPUP_TYPE.INPUT, "", { cancelButton: "取消" });
            if (!input) return;
            const tf = parseInt(input);
            if (isNaN(tf) || tf < 0 || tf > lastMessageId) return toastr.error(`❌ 无效的楼层号！`);
            
            const newMsg = createStandardMsg();
            context.chat.splice(tf + 1, 0, newMsg);
            if (typeof context.saveChat === 'function') await context.saveChat();
            if (typeof context.reloadCurrentChat === 'function') await context.reloadCurrentChat();
            toastr.success(`✅ 已成功插队到第 ${tf + 1} 楼！`);
        }
    } catch (e) { 
        console.error(e);
        toastr.error("❌ 导回失败！"); 
    }
}

// ================= 【图片生成系统】 =================
async function takeScreenshot(bm) {
    if (typeof window.html2canvas === 'undefined') {
        try { 
            toastr.info("🔄 正在加载绘图引擎...");
            await $.getScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"); 
        } 
        catch (e) { return toastr.error("❌ 无法加载截图引擎。"); }
    }

    const styleMenuHtml = `
        <div class="bkm-list-container">
            <h3 class="bkm-title">🎨 请选择图片生成风格</h3>
            <div class="bkm-grid">
                <button class="bkm-btn bkm-style-btn" data-style="dark" style="background:#1e1e2e; color:#cdd6f4; border:1px solid #cba6f7;">🌙 经典暗黑</button>
                <button class="bkm-btn bkm-style-btn" data-style="light" style="background:#f8f9fa; color:#4c4f69; border:1px solid #9ca0b0;">☀️ 纯净极简</button>
                <button class="bkm-btn bkm-style-btn" data-style="novel" style="background:#f4ecd8; color:#3e2723; border:1px solid #8d6e63; font-family: serif;">📜 古典羊皮纸</button>
                <button class="bkm-btn bkm-style-btn" data-style="cyber" style="background:#000000; color:#00ff00; border:1px solid #00ff00; font-family: monospace;">💻 赛博终端</button>
                <button class="bkm-btn bkm-style-btn" data-style="cute" style="background:#fff0f5; color:#d81b60; border:2px dashed #ffb6c1; border-radius:15px;">🌸 软萌初雪</button>
                <button class="bkm-btn bkm-style-btn" data-style="ocean" style="background:linear-gradient(135deg, #a8edea 0%, #fed6e3 100%); color:#2c3e50; border:1px solid #fff;">🌊 盛夏海浪</button>
                <button class="bkm-btn bkm-style-btn" data-style="matcha" style="background:#e8f5e9; color:#2e7d32; border:1px solid #81c784;">🍵 抹茶拿铁</button>
                <button class="bkm-btn bkm-style-btn" data-style="retro" style="background:#fff; color:#000; border:2px solid #000; box-shadow: 3px 3px 0px #ff90e8; border-radius:0;">📻 复古波普</button>
            </div>
        </div>
    `;

    const selectedStyle = await context.callGenericPopup(styleMenuHtml, context.POPUP_TYPE.TEXT, "", {
        okButton: false, cancelButton: "取消", 
        onOpen: (popup) => {
            $('.bkm-style-btn').on('click', function() { popup.complete($(this).data('style')); });
        }
    });

    if (!selectedStyle || selectedStyle === context.POPUP_RESULT.CANCELLED) return;

    toastr.info("📸 正在施展换装魔法...");

    const safeText = bm.text || "*(内容丢失)*";
    const formattedText = getRenderedHtml(safeText); // 魔法渲染替换
    const initialChar = bm.char ? bm.char.charAt(0).toUpperCase() : 'A';
    
    let cssWrapper = ''; let cssCard = ''; let cssAvatar = ''; let cssName = ''; let cssTime = ''; let cssText = ''; let cssDivider = '';
    if (selectedStyle === 'dark') { cssWrapper = 'background: #11111b;'; cssCard = 'background: rgba(30,30,46,0.9); border-radius: 16px; padding: 30px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1);'; cssAvatar = 'background: linear-gradient(135deg, #cba6f7, #f38ba8); color: #fff; border-radius: 50%;'; cssName = 'color: #cdd6f4; font-weight: bold; font-size: 1.3em;'; cssTime = 'color: #a6adc8;'; cssText = 'color: #bac2de; font-size: 1.1em; line-height: 1.7; font-family: sans-serif;'; cssDivider = 'border-bottom: 1px solid rgba(255,255,255,0.1);'; } 
    else if (selectedStyle === 'light') { cssWrapper = 'background: #e6e9ef;'; cssCard = 'background: #ffffff; border-radius: 20px; padding: 30px; box-shadow: 0 5px 20px rgba(0,0,0,0.05);'; cssAvatar = 'background: #e6e9ef; color: #4c4f69; border-radius: 50%; font-weight: 800;'; cssName = 'color: #1e1e2e; font-weight: 800; font-size: 1.2em;'; cssTime = 'color: #9ca0b0;'; cssText = 'color: #4c4f69; font-size: 1.05em; line-height: 1.6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;'; cssDivider = 'border-bottom: 1px solid rgba(0,0,0,0.05);'; } 
    else if (selectedStyle === 'novel') { cssWrapper = 'background: #d7ccc8;'; cssCard = 'background: #f4ecd8; padding: 40px; box-shadow: inset 0 0 50px rgba(0,0,0,0.05), 0 10px 20px rgba(0,0,0,0.1); border: 1px solid #d7ccc8;'; cssAvatar = 'background: transparent; color: #5d4037; border-radius: 0; font-family: serif; border-bottom: 2px solid #5d4037; height: auto; padding-bottom: 5px;'; cssName = 'color: #3e2723; font-weight: bold; font-size: 1.4em; font-family: serif;'; cssTime = 'color: #795548; font-family: serif;'; cssText = 'color: #212121; font-size: 1.15em; line-height: 2.0; font-family: "Georgia", serif; text-indent: 2em;'; cssDivider = 'border-bottom: none;'; } 
    else if (selectedStyle === 'cyber') { cssWrapper = 'background: #000000;'; cssCard = 'background: #050505; border-radius: 0; padding: 30px; border: 1px solid #00ff00; box-shadow: 0 0 15px rgba(0,255,0,0.2);'; cssAvatar = 'background: #002200; color: #00ff00; border-radius: 0; border: 1px solid #00ff00; font-family: monospace;'; cssName = 'color: #00ff00; font-weight: normal; font-size: 1.2em; font-family: monospace; text-transform: uppercase;'; cssTime = 'color: #008800; font-family: monospace;'; cssText = 'color: #00ff00; font-size: 1.05em; line-height: 1.5; font-family: monospace; text-shadow: 0 0 2px #00ff00;'; cssDivider = 'border-bottom: 1px dashed #00ff00;'; } 
    else if (selectedStyle === 'cute') { cssWrapper = 'background: #ffe4e1;'; cssCard = 'background: #fffafb; border-radius: 30px; padding: 35px; border: 4px dashed #ffb6c1; box-shadow: 0 10px 20px rgba(255, 182, 193, 0.3);'; cssAvatar = 'background: #ffb6c1; color: #fff; border-radius: 50%; box-shadow: 0 4px 10px rgba(255, 182, 193, 0.6);'; cssName = 'color: #d81b60; font-weight: 900; font-size: 1.3em;'; cssTime = 'color: #f06292;'; cssText = 'color: #880e4f; font-size: 1.1em; line-height: 1.6; font-family: "Comic Sans MS", "Arial Rounded MT Bold", sans-serif;'; cssDivider = 'border-bottom: 2px dotted #ffb6c1;'; } 
    else if (selectedStyle === 'ocean') { cssWrapper = 'background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);'; cssCard = 'background: rgba(255, 255, 255, 0.7); border-radius: 20px; padding: 30px; box-shadow: 0 8px 32px rgba(31, 38, 135, 0.15); border: 1px solid rgba(255, 255, 255, 0.4);'; cssAvatar = 'background: #ffffff; color: #4facfe; border-radius: 30%; box-shadow: inset 0 2px 5px rgba(0,0,0,0.1);'; cssName = 'color: #2c3e50; font-weight: bold; font-size: 1.3em;'; cssTime = 'color: #5d6d7e;'; cssText = 'color: #34495e; font-size: 1.1em; line-height: 1.7;'; cssDivider = 'border-bottom: 1px solid rgba(255,255,255,0.6);'; } 
    else if (selectedStyle === 'matcha') { cssWrapper = 'background: #e8f5e9;'; cssCard = 'background: #ffffff; border-radius: 12px; padding: 30px; box-shadow: 0 10px 15px rgba(46, 125, 50, 0.05); border-left: 8px solid #66bb6a;'; cssAvatar = 'background: #a5d6a7; color: #1b5e20; border-radius: 10px;'; cssName = 'color: #2e7d32; font-weight: bold; font-size: 1.25em;'; cssTime = 'color: #81c784;'; cssText = 'color: #388e3c; font-size: 1.05em; line-height: 1.8;'; cssDivider = 'border-bottom: 1px solid #c8e6c9;'; } 
    else if (selectedStyle === 'retro') { cssWrapper = 'background: linear-gradient(to top, #fbc2eb 0%, #a6c1ee 100%);'; cssCard = 'background: #ffffff; border-radius: 0; padding: 30px; border: 3px solid #000000; box-shadow: 8px 8px 0px #ff90e8;'; cssAvatar = 'background: #ffff00; color: #000; border-radius: 0; border: 2px solid #000; box-shadow: 3px 3px 0px #000; font-weight:900;'; cssName = 'color: #000000; font-weight: 900; font-size: 1.4em; text-transform: uppercase; letter-spacing: 1px;'; cssTime = 'color: #666; font-weight: bold;'; cssText = 'color: #000000; font-size: 1.1em; line-height: 1.6; font-weight: 500;'; cssDivider = 'border-bottom: 3px solid #000;'; }

    const container = document.createElement('div');
    container.style.cssText = `position:fixed; top:-9999px; left:0; width:650px; z-index:-9999; box-sizing:border-box; text-align: left; padding: 40px; ${cssWrapper}`;

    container.innerHTML = `
        <div style="${cssCard}">
            <div style="display: flex; align-items: center; margin-bottom: 20px; ${cssDivider} padding-bottom: 15px;">
                <div style="width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; font-size: 24px; margin-right: 15px; flex-shrink: 0; ${cssAvatar}">
                    ${initialChar}
                </div>
                <div style="flex: 1;">
                    <div style="${cssName}">${escapeHtml(bm.char || "未知")}</div>
                    <div style="font-size: 0.85em; margin-top: 5px; ${cssTime}">${selectedStyle === 'cyber' ? '> SYS.TIME: ' : (selectedStyle === 'cute' ? '🎀 ' : '🕒 ')}${escapeHtml(bm.time)} | ${selectedStyle === 'cyber' ? 'FLOOR_ID:' : '💬 第'} ${bm.floor !== undefined ? bm.floor : '?'} ${selectedStyle === 'cyber' ? '' : '楼'}</div>
                </div>
            </div>
            <div class="mes_text bkm-rendered-text" style="${cssText} word-wrap: break-word; text-align: justify !important;">
                ${formattedText}
            </div>
            ${selectedStyle === 'cyber' ? '<div style="color:#00ff00; font-family:monospace; margin-top:20px;">> EOF_</div>' : ''}
        </div>
    `;
    document.body.appendChild(container);

    try {
        await new Promise(r => setTimeout(r, 800)); 
        const canvas = await window.html2canvas(container, { backgroundColor: null, scale: 2, useCORS: true, logging: false });
        const url = canvas.toDataURL('image/png');
        
        const imgHtml = `
            <div style="text-align:center; max-height: 80vh; display: flex; flex-direction: column; align-items: center;">
                <div style="margin-bottom: 15px;">
                    <p style="color: var(--SmartThemeQuoteColor); font-weight: bold; margin: 0 0 10px 0;">✨ 魔法换装完成！</p>
                    <button id="bkm-real-download-btn" class="bkm-btn highlight" style="font-size: 1.1em; padding: 10px 30px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); border-radius: 20px;">
                        <i class="fa-solid fa-download"></i> 点击保存到手机 / 电脑
                    </button>
                </div>
                <div style="overflow-y: auto; width: 100%; border-radius: 12px; border: 2px solid var(--SmartThemeBorderColor);">
                    <img src="${url}" style="width: 100%; display: block;" />
                </div>
            </div>`;
            
        await context.callGenericPopup(imgHtml, context.POPUP_TYPE.TEXT, "", { 
            large: true, wide: true, okButton: false, cancelButton: "关闭",
            onOpen: () => {
                $('#bkm-real-download-btn').on('click', function() {
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `ST_收藏_${bm.char || '未知'}_${Date.now()}.png`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    toastr.success("📥 已触发下载！请查看通知栏或相册。");
                });
            }
        });
    } finally {
        document.body.removeChild(container);
    }
}
// =========================================================

// 【核心存储逻辑：提取与过滤】
async function doSaveMessage(text, msg, mesId, currentChatId) {
    const settings = extensionSettings[MODULE_NAME];

    // 1. 尝试提取特定标签 (如果配置了的话)
    if (settings.extractTags && settings.extractTags.trim() !== "") {
        const extracted = applyTagExtraction(text);
        if (extracted === "") {
            return toastr.warning(`⚠️ 未在消息中找到设定的提取标签 <${settings.extractTags}>，本次收藏已拦截。`);
        } else if (extracted !== null) {
            text = extracted; // 提取成功，替换文本
        }
    }

    // 2. 在提取完的基础上，再进行标签过滤 (剔除不想要的)
    if (settings.filterOnSave) {
        text = applyTagFilter(text);
    }
    
    if (!text || text.trim() === "") return toastr.warning("消息为空或已被完全过滤/提取失败，无实际内容可收藏。");

    // 检查是否已经存在完全相同的记录（防手滑连续点击）
    const isDuplicate = extensionSettings[MODULE_NAME].bookmarks.some(b => 
        b.text === text && b.chatId === currentChatId && b.floor === mesId
    );
    if (isDuplicate) {
        return toastr.warning("⚠️ 这条消息您已经收藏过了哦！");
    }

    extensionSettings[MODULE_NAME].bookmarks.push({ 
        time: new Date().toLocaleString(), 
        char: getRealCharName(msg), 
        role: msg.is_user ? 'User' : 'AI', 
        text: text, 
        floor: mesId, 
        chatId: currentChatId 
    });
    context.saveSettingsDebounced();
    toastr.success(`✨ 成功收藏第 ${mesId} 楼！`);
}

async function quickSaveLatest() {
    try {
        const lastMsgs = context.chat.slice(-1); 
        if (!lastMsgs || lastMsgs.length === 0) return toastr.warning("没有可收藏的消息。");
        const currentFloor = context.chat.length - 1;
        const lastMsg = lastMsgs[0];
        const textToSave = (lastMsg.swipes && lastMsg.swipes.length > 0) ? lastMsg.swipes[lastMsg.swipe_id || 0] : lastMsg.mes;
        
        await doSaveMessage(textToSave, lastMsg, currentFloor, context.getCurrentChatId());
    } catch (e) { toastr.error("❌ 收藏失败。"); }
}

async function showBookmarksUI(bms, titleStr) {
    if (!bms || bms.length === 0) return toastr.info("📂 收藏夹是空的或没有匹配项。");
    
    const groupsMap = new Map();
    bms.forEach(bm => {
        const dateStr = bm.time ? bm.time.split(' ')[0] : 'unknown';
        const key = (bm.chatId && bm.floor !== undefined) ? `${bm.chatId}_${bm.floor}` : `${bm.char}_${bm.floor}_${dateStr}`;
        if (!groupsMap.has(key)) {
            groupsMap.set(key, { char: bm.char || "未知", floor: bm.floor, time: bm.time || "未知", items:[] });
        }
        groupsMap.get(key).items.push(bm);
    });
    
    const groupedBookmarks = Array.from(groupsMap.values()).reverse();

    let htmlContent = `<div class="bkm-list-container">`;
    htmlContent += `<h3 class="bkm-title">${escapeHtml(titleStr)} <span class="bkm-count">(共 ${bms.length} 条)</span></h3>`;
    
    groupedBookmarks.forEach((group, gIndex) => {
        const floorText = group.floor !== undefined ? `第 ${group.floor} 楼` : `未知楼层`;
        const total = group.items.length;
        const firstText = applyTagFilter(group.items[0].text || "*(内容丢失)*");
        let previewText = escapeHtml(firstText.replace(/\n/g, ' ').substring(0, 35));
        if (firstText.length > 35) previewText += '...';

        htmlContent += `
        <div class="bkm-group-card">
            <div class="bkm-group-header">
                <div class="bkm-group-info">
                    <span class="bkm-avatar-name"><i class="fa-solid fa-user"></i> ${escapeHtml(group.char)}</span>
                    <span class="bkm-floor-badge">${floorText}</span>
                </div>
                <div class="bkm-time-info">🕒 ${escapeHtml(group.time)}</div>
            </div>
            
            <details class="bkm-details">
                <summary class="bkm-summary">
                    <div class="bkm-preview-box">
                        <span class="bkm-preview-text" id="bkm-preview-${gIndex}">${previewText}</span>
                        <span class="bkm-version-badge ${total > 1 ? '' : 'single'}">
                            ${total > 1 ? `${total}个版本 (点击展开)` : `展开详情`} <i class="fa-solid fa-chevron-down"></i>
                        </span>
                    </div>
                </summary>
                
                <div class="bkm-versions-list">
                    ${total > 1 ? `
                    <div class="bkm-swipe-controls">
                        <button class="bkm-swipe-btn bkm-prev" data-gindex="${gIndex}">&lt;</button>
                        <span id="bkm-counter-${gIndex}" style="font-weight:bold; font-size:1em; color:var(--SmartThemeBodyColor);">1 / ${total}</span>
                        <button class="bkm-swipe-btn bkm-next" data-gindex="${gIndex}">&gt;</button>
                    </div>` : ''}
                    
                    <div class="bkm-swipe-content-wrapper">`;
        
        group.items.forEach((item, iIndex) => {
            const safeItemText = item.text || "*(内容丢失)*";
            const formattedText = getRenderedHtml(safeItemText); // 魔法渲染替换
            
            htmlContent += `
                        <div id="bkm-content-${gIndex}-${iIndex}" style="display: ${iIndex === 0 ? 'block' : 'none'};">
                            <div class="bkm-version-toolbar">
                                <span class="bkm-version-label">当前版本：#${iIndex + 1}</span>
                                <div class="bkm-btn-group">
                                    <button class="bkm-icon-btn restore bkm-restore-btn" data-gindex="${gIndex}" data-iindex="${iIndex}"><i class="fa-solid fa-reply"></i> 导回</button>
                                    <button class="bkm-icon-btn shot bkm-shot-btn" data-gindex="${gIndex}" data-iindex="${iIndex}"><i class="fa-solid fa-image"></i> 长图</button>
                                </div>
                            </div>
                            <div class="mes_text bkm-rendered-text">${formattedText}</div>
                        </div>`;
        });
        
        htmlContent += `</div></div></details></div>`;
    });
    htmlContent += `</div>`;

    await context.callGenericPopup(htmlContent, context.POPUP_TYPE.TEXT, "", {
        large: true, wide: true, cancelButton: "返回", okButton: false, allowVerticalScrolling: true,
        onOpen: (popup) => {
            const groupStates = {};
            groupedBookmarks.forEach((g, idx) => groupStates[idx] = { current: 0, max: g.items.length, items: g.items });

            $('.bkm-prev, .bkm-next').on('click', function(e) {
                e.preventDefault(); e.stopPropagation();
                const gIndex = $(this).data('gindex');
                const dir = $(this).hasClass('bkm-next') ? 1 : -1;
                const state = groupStates[gIndex];
                
                $(`#bkm-content-${gIndex}-${state.current}`).hide();
                state.current = (state.current + dir + state.max) % state.max;
                $(`#bkm-content-${gIndex}-${state.current}`).show();
                $(`#bkm-counter-${gIndex}`).text(`${state.current + 1} / ${state.max}`);
                
                const safeText = applyTagFilter(state.items[state.current].text || "");
                let preview = escapeHtml(safeText.replace(/\n/g, ' ').substring(0, 35));
                if (safeText.length > 35) preview += '...';
                $(`#bkm-preview-${gIndex}`).text(preview);
            });

            $('.bkm-shot-btn').on('click', async function(e) { e.preventDefault(); e.stopPropagation(); await takeScreenshot(groupedBookmarks[$(this).data('gindex')].items[$(this).data('iindex')]); });
            $('.bkm-restore-btn').on('click', async function(e) { e.preventDefault(); e.stopPropagation(); await restoreBookmarkToChat(groupedBookmarks[$(this).data('gindex')].items[$(this).data('iindex')]); });
        }
    });
}

async function showMultiSelectUI(items, config) {
    let htmlContent = `<div class="bkm-list-container">`;
    htmlContent += `<h3 class="bkm-title" style="color: ${config.color || 'var(--SmartThemeQuoteColor)'};">${config.title}</h3>`;
    htmlContent += `<div class="bkm-grid"><button id="btn-sel-all" class="bkm-btn">✅ 全选</button><button id="btn-sel-none" class="bkm-btn">❌ 全不选</button></div><div class="bkm-flex-col">`;
    
    items.forEach((item, index) => {
        const formattedFullText = getRenderedHtml(item.fullText); // 魔法渲染
        htmlContent += `
        <div class="bkm-group-card" style="padding:12px; width: 100%; box-sizing: border-box; display: block;">
            <div style="display:flex; align-items:flex-start; gap: 10px; width: 100%;">
                <input type="checkbox" id="cb-${index}" class="bkm-sel-cb" data-value="${item.value}" style="width:20px; height:20px; margin-top:2px; flex-shrink:0;">
                <label for="cb-${index}" style="font-size: 0.95em; flex: 1; min-width: 0; line-height:1.4; word-break: break-all; margin:0; text-align: left;">${item.label}</label>
            </div>
            <details class="bkm-details" style="margin-top: 8px; margin-left: 0px; padding-left: 30px; box-sizing: border-box; width: 100%;">
                <summary style="font-size: 0.85em; color: var(--SmartThemeQuoteColor); text-align: left;">(点击展开完整内容)</summary>
                <div class="mes_text bkm-rendered-text" style="margin-top: 8px; white-space: normal; word-break: break-all;">${formattedFullText}</div>
            </details>
        </div>`;
    });
    htmlContent += `</div></div>`;
    
    let selectedSet = new Set();
    const choice = await context.callGenericPopup(htmlContent, context.POPUP_TYPE.TEXT, "", {
        okButton: config.okButtonText, 
        cancelButton: "取消", 
        large: true, 
        wide: true,
        allowVerticalScrolling: true,
        onOpen: () => {
            $('.bkm-sel-cb').on('change', function() { const val = $(this).data('value'); if ($(this).is(':checked')) selectedSet.add(val); else selectedSet.delete(val); });
            $('#btn-sel-all').on('click', () => { $('.bkm-sel-cb').prop('checked', true).each(function() { selectedSet.add($(this).data('value')); }); });
            $('#btn-sel-none').on('click', () => { $('.bkm-sel-cb').prop('checked', false); selectedSet.clear(); });
        }
    });
    if (choice === context.POPUP_RESULT.AFFIRMATIVE) return Array.from(selectedSet);
    return null;
}

async function downloadData(content, filename, mimeType) {
    try {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none'; a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
        toastr.success('📄 下载已开始！');
    } catch (e) { toastr.error("❌ 下载失败。"); }
}

function generateTxtContent(bms) {
    let txt = `=== 全局精选收藏夹 (共 ${bms.length} 条) ===\n\n`;
    const sortedBms =[...bms].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
    sortedBms.forEach((bm, i) => { 
        const filteredText = applyTagFilter(bm.text || "");
        txt += `[#${i+1}] 剧本: ${bm.char || "未知"} | 发送者: ${bm.role || "未知"} | 楼层: ${bm.floor !== undefined ? bm.floor : '未知'} | 时间: ${bm.time || "未知"}\n${filteredText}\n--------------------------------------------------\n\n`; 
    });
    return txt;
}

// ================= 主菜单 =================
async function openMainMenu() {
    let keepRunning = true;
    while (keepRunning) {
        const menuHtml = `
            <div class="bkm-list-container">
                <h3 class="bkm-title" style="text-align:center;">🌟 聊天收藏夹 Pro</h3>
                <div class="bkm-grid">
                    <button id="btn-bkm-10" class="bkm-menu-btn"><i class="fa-solid fa-bookmark" style="color:#a6e3a1;"></i> 快速收藏(最新)</button>
                    <button id="btn-bkm-11" class="bkm-menu-btn"><i class="fa-solid fa-thumbtack" style="color:#f9e2af;"></i> 收藏指定楼层</button>
                    <button id="btn-bkm-16" class="bkm-menu-btn"><i class="fa-solid fa-clock-rotate-left" style="color:#89b4fa;"></i> 查阅历史生成</button>
                    <button id="btn-bkm-17" class="bkm-menu-btn"><i class="fa-solid fa-magnifying-glass" style="color:#cba6f7;"></i> 搜索收藏记录</button>
                    
                    <button id="btn-bkm-12" class="bkm-menu-btn full-width highlight"><i class="fa-solid fa-folder-open"></i> 浏览所有收藏 (可导回)</button>
                    
                    <button id="btn-bkm-18" class="bkm-menu-btn" style="color:#f38ba8;"><i class="fa-solid fa-trash-can"></i> 管理与删除</button>
                    <button id="btn-bkm-13" class="bkm-menu-btn" style="color:#74c7ec;"><i class="fa-solid fa-file-export"></i> 导出与备份</button>
                    <button id="btn-bkm-15" class="bkm-menu-btn" style="color:#a6e3a1;"><i class="fa-solid fa-file-import"></i> 导入备份数据</button>
                    
                    <button id="btn-bkm-19" class="bkm-menu-btn full-width"><i class="fa-solid fa-gear" style="color:#94e2d5;"></i> 标签过滤/提取 设置</button>
                </div>
            </div>
        `;

        const choice = await context.callGenericPopup(menuHtml, context.POPUP_TYPE.TEXT, "", {
            cancelButton: "退出", okButton: false, allowVerticalScrolling: true,
            onOpen: (popup) => {
                $('.bkm-menu-btn').on('click', function() { 
                    const idStr = $(this).attr('id');
                    if(idStr) popup.complete(parseInt(idStr.replace('btn-bkm-', ''))); 
                });
            }
        });

        if (!choice || choice === context.POPUP_RESULT.CANCELLED) { keepRunning = false; break; }

        const allBms = extensionSettings[MODULE_NAME].bookmarks;

        switch (choice) {
            case 10: await quickSaveLatest(); break;
            
            case 11:
                const inputFloor = await context.callGenericPopup("请输入要收藏的楼层号：", context.POPUP_TYPE.INPUT, "", { cancelButton: "取消" });
                if (!inputFloor) break;
                const mesId = parseInt(inputFloor);
                if (isNaN(mesId) || !context.chat[mesId]) { toastr.error("❌ 找不到该楼层！"); break; }
                const msg = context.chat[mesId];
                const text = (msg.swipes && msg.swipes.length > 0) ? msg.swipes[msg.swipe_id || 0] : msg.mes;
                
                await doSaveMessage(text, msg, mesId, context.getCurrentChatId());
                break;
                
            case 16:
                const range = await context.callGenericPopup("请输入要查阅的楼层号：", context.POPUP_TYPE.INPUT, "", { cancelButton: "取消" });
                if (!range || !context.chat[parseInt(range)]) { toastr.error("❌ 无效楼层！"); break; }
                const targetMsg = context.chat[parseInt(range)];
                const targetSwipes = targetMsg.swipes || [targetMsg.mes];
                const rChar = getRealCharName(targetMsg);
                const swipeItems = targetSwipes.map((t, i) => ({ text: t, char: rChar, time: new Date().toLocaleString(), role: targetMsg.is_user ? 'User' : 'AI', floor: parseInt(range), chatId: context.getCurrentChatId() }));
                await showBookmarksUI(swipeItems, `第 ${range} 楼的历史生成`);
                break;
                
            case 17:
                const keyword = await context.callGenericPopup("请输入搜索关键字：", context.POPUP_TYPE.INPUT, "", { cancelButton: "取消" });
                if (!keyword || !keyword.trim()) break;
                const filtered = allBms.filter(b => (b.char && b.char.includes(keyword)) || (b.text && b.text.includes(keyword)));
                await showBookmarksUI([...filtered], `搜索结果: "${keyword}"`);
                break;
                
            case 12: { 
                const viewHtml = `<div class="bkm-list-container"><h3 class="bkm-title">📂 请选择浏览模式</h3><div class="bkm-flex-col"><button id="view-latest" class="bkm-btn highlight">🆕 最新优先 (默认)</button><button id="view-char" class="bkm-btn">👤 按角色分类</button><button id="view-date" class="bkm-btn">📅 按日期分类</button><button id="view-oldest" class="bkm-btn">⏳ 按时间排序 (从旧到新)</button></div></div>`;
                const viewChoice = await context.callGenericPopup(viewHtml, context.POPUP_TYPE.TEXT, "", {
                    okButton: false, cancelButton: "返回", allowVerticalScrolling: true,
                    onOpen: (popup) => { $('#view-latest').on('click', () => popup.complete(1)); $('#view-char').on('click', () => popup.complete(2)); $('#view-date').on('click', () => popup.complete(3)); $('#view-oldest').on('click', () => popup.complete(4)); }
                });
                
                if (!viewChoice || viewChoice === context.POPUP_RESULT.CANCELLED) break;
                if (allBms.length === 0) { toastr.info("收藏夹为空。"); break; }

                if (viewChoice === 1) await showBookmarksUI([...allBms], "所有收藏 (最新优先)");
                else if (viewChoice === 4) await showBookmarksUI([...allBms].reverse(), "所有收藏 (时间顺序)");
                else if (viewChoice === 2) {
                    const charGroups =[...allBms].reverse().reduce((acc, bm) => { const c = bm.char || '未知角色'; if (!acc[c]) acc[c] = { count: 0, items: [] }; acc[c].count++; acc[c].items.push(bm); return acc; }, {});
                    const charKeys = Object.keys(charGroups);
                    let charHtml = `<div class="bkm-list-container"><h3 class="bkm-title">👤 请选择角色</h3><div class="bkm-flex-col">`;
                    charKeys.forEach((c, idx) => { charHtml += `<button class="bkm-btn char-btn" data-idx="${idx}">${escapeHtml(c)} <span style="opacity:0.6; font-size:0.9em; margin-left:auto;">(${charGroups[c].count}条)</span></button>`; });
                    charHtml += `</div></div>`;
                    const cChoice = await context.callGenericPopup(charHtml, context.POPUP_TYPE.TEXT, "", { okButton: false, cancelButton: "返回", allowVerticalScrolling: true, onOpen: (p) => { $('.char-btn').on('click', function() { p.complete(parseInt($(this).data('idx')) + 1000); }); } });
                    if (cChoice >= 1000) await showBookmarksUI(charGroups[charKeys[cChoice - 1000]].items, `角色收藏: ${charKeys[cChoice - 1000]}`);
                } else if (viewChoice === 3) {
                    const dateGroups =[...allBms].reverse().reduce((acc, bm) => { const d = bm.time ? new Date(bm.time).toLocaleDateString() : '未知日期'; if (!acc[d]) acc[d] = { count: 0, items: [] }; acc[d].count++; acc[d].items.push(bm); return acc; }, {});
                    const dateKeys = Object.keys(dateGroups);
                    let dateHtml = `<div class="bkm-list-container"><h3 class="bkm-title">📅 请选择日期</h3><div class="bkm-flex-col">`;
                    dateKeys.forEach((d, idx) => { dateHtml += `<button class="bkm-btn date-btn" data-idx="${idx}">${d} <span style="opacity:0.6; font-size:0.9em; margin-left:auto;">(${dateGroups[d].count}条)</span></button>`; });
                    dateHtml += `</div></div>`;
                    const dChoice = await context.callGenericPopup(dateHtml, context.POPUP_TYPE.TEXT, "", { okButton: false, cancelButton: "返回", allowVerticalScrolling: true, onOpen: (p) => { $('.date-btn').on('click', function() { p.complete(parseInt($(this).data('idx')) + 2000); }); } });
                    if (dChoice >= 2000) await showBookmarksUI(dateGroups[dateKeys[dChoice - 2000]].items, `日期收藏: ${dateKeys[dChoice - 2000]}`);
                }
                break;
            }
                
            case 18:
                if (allBms.length === 0) { toastr.info("收藏夹为空。"); break; }
                const itemsToDelete =[...allBms].reverse().map((bm, i) => ({ 
                    label: `[${escapeHtml(bm.char)} - 第${bm.floor}楼] ${escapeHtml((bm.text || "").substring(0, 25))}...`, 
                    value: allBms.length - 1 - i, 
                    fullText: bm.text 
                }));
                const indicesToDelete = await showMultiSelectUI(itemsToDelete, { title: '🗑️ 勾选要删除的收藏', okButtonText: '永久删除', color: '#ff6666' });
                if (indicesToDelete && indicesToDelete.length > 0) {
                    indicesToDelete.sort((a, b) => b - a).forEach(idx => allBms.splice(idx, 1));
                    context.saveSettingsDebounced();
                    toastr.success(`🗑️ 已成功删除 ${indicesToDelete.length} 条收藏！`);
                }
                break;
                
            case 13: { 
                let exportSubMenuRunning = true;
                while(exportSubMenuRunning) {
                    const exportHtml = `<div class="bkm-list-container"><h3 class="bkm-title">📤 导出与备份</h3><div class="bkm-flex-col"><button id="exp-json" class="bkm-btn highlight">🗄️ 导出完整备份 (JSON)</button><button id="exp-copy" class="bkm-btn">📋 复制全部到剪贴板 (TXT)</button><hr style="border:0; border-top:1px dashed var(--SmartThemeBorderColor); margin: 5px 0;"><button id="exp-all" class="bkm-btn">📄 导出全部 (TXT)</button><button id="exp-char" class="bkm-btn">👤 按角色导出 (TXT)</button><button id="exp-date" class="bkm-btn">📅 按日期导出 (TXT)</button><button id="exp-range" class="bkm-btn">🔢 按范围导出 (TXT)</button><button id="exp-select" class="bkm-btn">☑️ 自由勾选导出 (TXT)</button></div></div>`;
                    const exportTypeChoice = await context.callGenericPopup(exportHtml, context.POPUP_TYPE.TEXT, "", {
                        okButton: false, cancelButton: "返回主菜单", allowVerticalScrolling: true,
                        onOpen: (popup) => { $('#exp-all').on('click', () => popup.complete(1)); $('#exp-char').on('click', () => popup.complete(2)); $('#exp-date').on('click', () => popup.complete(3)); $('#exp-range').on('click', () => popup.complete(4)); $('#exp-select').on('click', () => popup.complete(5)); $('#exp-json').on('click', () => popup.complete(6)); $('#exp-copy').on('click', () => popup.complete(7)); }
                    });

                    if (!exportTypeChoice || exportTypeChoice === context.POPUP_RESULT.CANCELLED) { exportSubMenuRunning = false; break; }
                    if (allBms.length === 0) { toastr.warning("收藏夹为空！"); break; }
                    
                    if (exportTypeChoice === 6) { 
                        const jsonStr = JSON.stringify(allBms, null, 2);
                        const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                        await downloadData(jsonStr, `全部收藏备份_${dateStr}.json`, 'application/json');
                        exportSubMenuRunning = false; continue;
                    }
                    
                    if (exportTypeChoice === 7) { 
                        try {
                            await navigator.clipboard.writeText(generateTxtContent(allBms));
                            toastr.success('✅ 已复制全部收藏到剪贴板！');
                        } catch (e) { toastr.error('❌ 复制失败，您的浏览器不支持此操作。'); }
                        exportSubMenuRunning = false; continue;
                    }

                    let bmsToExport =[];
                    if (exportTypeChoice === 1) { bmsToExport = allBms; } 
                    else if (exportTypeChoice === 4) {
                        const rangeInput = await context.callGenericPopup("请输入范围 (如 5, 或 1-10)\n#1代表最新一条", context.POPUP_TYPE.INPUT, "", {cancelButton:"取消"});
                        if (!rangeInput) continue;
                        const reversedBms = [...allBms].reverse();
                        let start, end;
                        if (rangeInput.includes('-')) { [start, end] = rangeInput.split('-').map(n => parseInt(n.trim())); } else { start = end = parseInt(rangeInput.trim()); }
                        if (isNaN(start) || isNaN(end) || start > end || start < 1 || end > reversedBms.length) { toastr.error("范围无效！"); continue; }
                        bmsToExport = reversedBms.slice(start - 1, end);
                    } else if (exportTypeChoice === 5) {
                        const selectedIndices = await showMultiSelectUI(allBms.map((bm, i) => ({ label: `[${escapeHtml(bm.char)}] ${escapeHtml(applyTagFilter(bm.text).substring(0,25))}...`, value: i, fullText: applyTagFilter(bm.text) })), { title: '☑️ 请勾选要导出的收藏', okButtonText: '导出选中项' });
                        if (selectedIndices) bmsToExport = selectedIndices.map(idx => allBms[idx]);
                    } else if (exportTypeChoice === 2 || exportTypeChoice === 3) {
                        const isChar = exportTypeChoice === 2;
                        const groups =[...allBms].reverse().reduce((acc, bm) => { const key = isChar ? (bm.char || '未知角色') : (bm.time ? new Date(bm.time).toLocaleDateString() : '未知日期'); if (!acc[key]) acc[key] = { count: 0 }; acc[key].count++; return acc; }, {});
                        const items = Object.keys(groups).map(key => ({ label: `${escapeHtml(key)} <span style="opacity:0.6; font-size:0.9em;">(${groups[key].count}条)</span>`, value: key }));
                        const selectedKeys = await showMultiSelectUI(items, { title: `请选择要导出的${isChar ? '角色' : '日期'}`, okButtonText: '确认导出' });
                        if (selectedKeys && selectedKeys.length > 0) {
                            const keySet = new Set(selectedKeys);
                            bmsToExport = allBms.filter(bm => keySet.has(isChar ? (bm.char || '未知角色') : (bm.time ? new Date(bm.time).toLocaleDateString() : '未知日期')));
                        }
                    }

                    if (bmsToExport.length > 0) {
                        const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                        await downloadData(generateTxtContent(bmsToExport), `精选收藏_${dateStr}.txt`, 'text/plain');
                        exportSubMenuRunning = false;
                    }
                }
                break;
            }

            case 15: { 
                const modeChoice = await context.callGenericPopup(`<div class="bkm-list-container"><h3 style="margin-top:0; text-align:left; color:var(--SmartThemeQuoteColor);">请选择导入模式</h3><p style="font-size:0.9em; opacity:0.9; text-align:left; line-height:1.5;"><b>🤝 合并：</b>只添加新的、不重复的记录。<br><br><b style="color:#ff6666;">💥 覆盖：</b>清空您所有收藏，完全替换为导入文件。</p></div>`, context.POPUP_TYPE.CONFIRM, "", { okButton: "🤝 合并导入", cancelButton: "💥 覆盖导入" });
                if (modeChoice === context.POPUP_RESULT.CANCELLED && !confirm("确定要覆盖吗？所有现有收藏将丢失！")) break;
                
                const importMode = (modeChoice === context.POPUP_RESULT.AFFIRMATIVE) ? 'merge' : 'overwrite';
                const importHtml = `<div class="bkm-list-container" style="max-width: 400px;"><h3 class="bkm-title">📥 导入备份 (${importMode === 'merge' ? '合并' : '覆盖'})</h3><textarea id="bkm-import-textarea" placeholder="在此粘贴 JSON 或 TXT 备份文本..." style="width:100%; height:25vh; background:var(--SmartThemeBlurTintColor); color:var(--SmartThemeBodyColor); border:1px solid var(--SmartThemeBorderColor); border-radius:10px; padding:10px; box-sizing:border-box; outline:none; resize:vertical;"></textarea><div class="bkm-flex-col" style="margin-top:15px;"><button id="bkm-import-paste" class="bkm-btn highlight">📋 确认导入框内文本</button><button id="bkm-import-file" class="bkm-btn">📁 选择本地文件 (.json / .txt)</button></div></div>`;
                
                const handleImportData = async (text, mode) => {
                    let newBookmarks =[]; let importType = '';
                    try { const data = JSON.parse(text); if (Array.isArray(data)) { newBookmarks = data; importType = 'JSON'; } } catch (e) {}
                    if (importType === '') {
                        const regex = /\[#\d+\] 剧本: (.*?) \| 发送者: (.*?) \| 楼层: (.*?) \| 时间: (.*?)\n([\s\S]*?)\n--------------------------------------------------/g;
                        let match;
                        while ((match = regex.exec(text)) !== null) { newBookmarks.push({ char: match[1].trim(), role: match[2].trim(), floor: isNaN(parseInt(match[3])) ? undefined : parseInt(match[3]), time: match[4].trim(), text: match[5].trim() }); }
                        if (newBookmarks.length > 0) importType = 'TXT';
                    }
                    if (importType === '') return toastr.error("❌ 解析失败！请确保是正确的 JSON 或 TXT 备份格式。");

                    if (mode === 'overwrite') {
                        extensionSettings[MODULE_NAME].bookmarks = newBookmarks;
                        toastr.success(`💥 [${importType}] 覆盖成功！已导入 ${newBookmarks.length} 条。`);
                    } else {
                        const existingTexts = new Set(extensionSettings[MODULE_NAME].bookmarks.map(b => b.text));
                        let addedCount = 0;
                        newBookmarks.forEach(newItem => { if (newItem.text && !existingTexts.has(newItem.text)) { extensionSettings[MODULE_NAME].bookmarks.push(newItem); existingTexts.add(newItem.text); addedCount++; } });
                        toastr.success(`🤝 [${importType}] 合并完成！新增了 ${addedCount} 条记录。`);
                    }
                    context.saveSettingsDebounced();
                };

                await context.callGenericPopup(importHtml, context.POPUP_TYPE.TEXT, "", {
                    okButton: false, cancelButton: "取消", allowVerticalScrolling: true,
                    onOpen: (popup) => {
                        $('#bkm-import-paste').on('click', async () => { const pastedText = $('#bkm-import-textarea').val(); if (!pastedText.trim()) toastr.warning("文本框为空！"); else { await handleImportData(pastedText, importMode); popup.complete(1); } });
                        $('#bkm-import-file').on('click', () => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,.txt'; input.onchange = e => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = async (re) => { await handleImportData(re.target.result, importMode); popup.complete(1); }; reader.readAsText(file); }; input.click(); });
                    }
                });
                break;
            }

            case 19:
                toastr.info("请在酒馆顶部的 '扩展设置' 面板中配置标签哦！");
                break;
        }
    }
}

// 悬浮球
function makeDraggable(fab) {
    let isDragging = false;
    let startX, startY, initialTop, initialLeft;
    
    fab.on('mousedown touchstart', function(e) {
        isDragging = false;
        const ev = e.originalEvent;
        startX = ev.touches ? ev.touches[0].clientX : ev.clientX;
        startY = ev.touches ? ev.touches[0].clientY : ev.clientY;
        const rect = this.getBoundingClientRect();
        initialTop = rect.top; initialLeft = rect.left;

        $(document).on('mousemove.bkmDrag touchmove.bkmDrag', function(eMove) {
            const evMove = eMove.originalEvent;
            const dx = (evMove.touches ? evMove.touches[0].clientX : evMove.clientX) - startX;
            const dy = (evMove.touches ? evMove.touches[0].clientY : evMove.clientY) - startY;

            if (!isDragging && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) isDragging = true;
            if (isDragging) {
                eMove.preventDefault();
                fab.css({ top: initialTop + dy + 'px', left: initialLeft + dx + 'px', bottom: 'auto', right: 'auto' });
            }
        });

        $(document).on('mouseup.bkmDrag touchend.bkmDrag', function() {
            $(document).off('.bkmDrag');
            if (isDragging) {
                extensionSettings[MODULE_NAME].fabPosition = { top: fab.css('top'), left: fab.css('left') };
                context.saveSettingsDebounced();
            }
            setTimeout(() => { isDragging = false; }, 50);
        });
    });

    fab.on('click', function(e) {
        if (isDragging) { e.preventDefault(); e.stopPropagation(); return; }
        openMainMenu();
    });
}

function toggleFAB() {
    extensionSettings[MODULE_NAME].showFloatingButton ? $('#bkm-fab-container').css('display', 'flex') : $('#bkm-fab-container').css('display', 'none');
}

async function initUI() {
    loadSettings();

    const possiblePaths =['/scripts/extensions/third-party/shoucang/settings.html', '/scripts/extensions/third-party/SillyTavern-shoucang/settings.html', '/scripts/extensions/third-party/shoucang-main/settings.html', '/scripts/extensions/third-party/global_bookmarks_pro/settings.html'];
    for (const path of possiblePaths) {
        try {
            const settingsHtml = await $.get(path);
            if (settingsHtml) {
                $('#extensions_settings').append(settingsHtml);
                $('#bkm-setting-show-fab').prop('checked', extensionSettings[MODULE_NAME].showFloatingButton).on('change', (e) => {
                    extensionSettings[MODULE_NAME].showFloatingButton = $(e.target).prop('checked'); context.saveSettingsDebounced(); toggleFAB();
                });
                $('#bkm-setting-filter-tags').val(extensionSettings[MODULE_NAME].filterTags).on('input', (e) => {
                    extensionSettings[MODULE_NAME].filterTags = $(e.target).val(); context.saveSettingsDebounced();
                });
                
                // 新增提取标签
                $('#bkm-setting-extract-tags').val(extensionSettings[MODULE_NAME].extractTags || "").on('input', (e) => {
                    extensionSettings[MODULE_NAME].extractTags = $(e.target).val(); context.saveSettingsDebounced();
                });

                $('#bkm-setting-remove-before').prop('checked', extensionSettings[MODULE_NAME].removeBeforeClosing).on('change', (e) => {
                    extensionSettings[MODULE_NAME].removeBeforeClosing = $(e.target).prop('checked'); context.saveSettingsDebounced();
                });

                $('#bkm-setting-filter-on-save').prop('checked', extensionSettings[MODULE_NAME].filterOnSave).on('change', (e) => {
                    extensionSettings[MODULE_NAME].filterOnSave = $(e.target).prop('checked'); context.saveSettingsDebounced();
                });

                $('#bkm-btn-clean-existing').on('click', async () => {
                    const bms = extensionSettings[MODULE_NAME].bookmarks;
                    if (!bms || bms.length === 0) return toastr.info("收藏夹为空，不需要清理。");
                    
                    const confirmRes = await context.callGenericPopup("确定要清理所有现有收藏中的标签内容吗？<br><br><span style='color:#ff6666;'>清洗后，原记录里多余的标签将被永久删除，大幅释放存储空间。</span>", context.POPUP_TYPE.CONFIRM, "", { okButton: "确定清理瘦身", cancelButton: "取消" });
                    
                    if (confirmRes === context.POPUP_RESULT.AFFIRMATIVE) {
                        let cleanedCount = 0;
                        bms.forEach(bm => {
                            let newText = bm.text;
                            // 先走提取
                            if (extensionSettings[MODULE_NAME].extractTags && extensionSettings[MODULE_NAME].extractTags.trim() !== '') {
                                const ext = applyTagExtraction(newText);
                                if (ext) newText = ext;
                            }
                            // 后走过滤
                            newText = applyTagFilter(newText);
                            
                            if (bm.text !== newText) {
                                bm.text = newText;
                                cleanedCount++;
                            }
                        });
                        context.saveSettingsDebounced();
                        toastr.success(`🧹 瘦身大扫除完成！共洗净了 ${cleanedCount} 条记录的冗余标签！`);
                    }
                });

                // 新增重置悬浮球按钮
                $('#bkm-btn-reset-fab').on('click', () => {
                    extensionSettings[MODULE_NAME].fabPosition = { top: '30%', left: '85%' };
                    context.saveSettingsDebounced();
                    $('#bkm-fab-container').css({ top: '30%', left: '85%', bottom: 'auto', right: 'auto' });
                    toastr.success("🔄 悬浮球位置已重置为默认！");
                });

                break;
            }
        } catch (e) { continue; }
    }

    if ($('#bkm-fab-container').length === 0) {
        $('body').append(`<div id="bkm-fab-container" class="has-tooltip" data-tooltip="全局收藏夹 (可拖动)"><i class="fa-solid fa-star"></i></div>`);
        const fab = $('#bkm-fab-container');
        fab.css({ top: extensionSettings[MODULE_NAME].fabPosition.top, left: extensionSettings[MODULE_NAME].fabPosition.left });
        makeDraggable(fab);
    }
    toggleFAB();

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'bkm_latest', callback: async () => { await quickSaveLatest(); return ""; }, returns: '无返回值', helpString: '快速收藏最新消息' }));
}

eventSource.on(event_types.APP_READY, initUI);

$(document).on('click', '#global-bookmarks .mes_reasoning_header, #global-bookmarks .reasoning-header', function(event) {
    event.preventDefault();
    event.stopPropagation();
    const $header = $(this);
    const $content = $header.next('.mes_reasoning_content, .reasoning-content');
    $content.slideToggle(200, function() {
        $header.find('.fa-chevron-down').toggleClass('fa-rotate-180', $content.is(':visible'));
    });
});

document.addEventListener('click', function(e) {
    const qrBtn = e.target.closest('.qr--button, .qr-button');
    if (qrBtn) {
        const btnText = qrBtn.textContent.trim();
        if (btnText === '收藏' || btnText.includes('收藏')) {
            e.preventDefault();
            e.stopPropagation(); 
            if (typeof quickSaveLatest === 'function') quickSaveLatest();
        }
    }
}, true); 
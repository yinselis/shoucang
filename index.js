const context = SillyTavern.getContext();
const { eventSource, event_types, extensionSettings, SlashCommandParser, SlashCommand } = context;

const MODULE_NAME = 'global_bookmarks_pro';
const defaultSettings = {
    showFloatingButton: true,
    filterTags: 'think',
    removeBeforeClosing: true,
    bookmarks:[],
    fabPosition: { top: '30%', left: '85%' }
};

function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ================= 超级标签过滤逻辑 =================
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

function loadSettings() {
    if (!extensionSettings[MODULE_NAME]) extensionSettings[MODULE_NAME] = {};
    for (const key in defaultSettings) {
        if (extensionSettings[MODULE_NAME][key] === undefined) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
}

// ================= 导回聊天功能 (照搬原版逻辑) =================
async function restoreBookmarkToChat(bm) {
    try {
        const lastMessageId = context.chat.length - 1;
        let optionsHtml = `<div class="bkm-container"><h3 class="bkm-title">↩️ 请选择导回位置</h3><div class="bkm-flex-col">`;
        if (bm.floor !== undefined && bm.floor <= lastMessageId && bm.floor >= 0) {
            optionsHtml += `<button id="res-orig" class="bkm-btn bkm-btn-highlight">🔙 恢复到原楼层 (第 ${bm.floor} 楼)</button>`;
        }
        if (lastMessageId >= 0) {
            optionsHtml += `<button id="res-last" class="bkm-btn">⬇️ 追加到最新楼层 (第 ${lastMessageId} 楼)</button>`;
            optionsHtml += `<button id="res-custom" class="bkm-btn">🔢 插入到自定义楼层</button>`;
        }
        optionsHtml += `<button id="res-new" class="bkm-btn">🆕 作为全新消息发送到末尾</button></div></div>`;

        const choice = await context.callGenericPopup(optionsHtml, context.POPUP_TYPE.TEXT, "", {
            okButton: false, cancelButton: "取消",
            onOpen: async (popup) => {
                $('#res-orig').on('click', () => popup.complete(1));
                $('#res-last').on('click', () => popup.complete(2));
                $('#res-new').on('click', () => popup.complete(3));
                $('#res-custom').on('click', () => popup.complete(4));
            }
        });

        if (!choice || choice === context.POPUP_RESULT.CANCELLED) return;
        const safeText = bm.text || "*(内容丢失)*";

        if (choice === 1 || choice === 2 || choice === 4) {
            let targetFloor;
            if (choice === 1) targetFloor = bm.floor;
            else if (choice === 2) targetFloor = lastMessageId;
            else if (choice === 4) {
                const input = await context.callGenericPopup(`请输入楼层号 (0 - ${lastMessageId})：`, context.POPUP_TYPE.INPUT, "", { cancelButton: "取消" });
                if (!input) return;
                targetFloor = parseInt(input);
                if (isNaN(targetFloor) || targetFloor < 0 || targetFloor > lastMessageId) return toastr.error(`❌ 无效的楼层号！`);
            }
            
            const targetMsg = context.chat[targetFloor];
            if (!targetMsg) return toastr.error("❌ 找不到目标楼层！");
            
            if (!targetMsg.swipes) targetMsg.swipes = [targetMsg.mes || ""];
            if (targetMsg.swipes.includes(safeText)) return toastr.warning("⚠️ 该楼层已存在完全相同的文本分页。");
            
            targetMsg.swipes.push(safeText);
            targetMsg.swipe_id = targetMsg.swipes.length - 1;
            targetMsg.mes = safeText;

            context.updateMessageBlock(targetFloor, targetMsg);
            context.saveChat();
            toastr.success(`✅ 已作为【第 ${targetMsg.swipes.length} 页】插入到第 ${targetFloor} 楼！`);
        } else if (choice === 3) {
            const isUser = (bm.role || "").toLowerCase() === 'user' || bm.role === (context.name1 || "User");
            context.chat.push({
                name: isUser ? context.name1 : (bm.char || "AI"),
                is_user: isUser,
                is_system: false,
                send_date: Date.now(),
                mes: safeText,
                swipes: [safeText]
            });
            context.updateMessageBlock(context.chat.length - 1, context.chat[context.chat.length - 1]);
            context.saveChat();
            toastr.success(`✅ 已作为新消息追加到末尾！`);
        }
    } catch (e) { toastr.error("❌ 导回失败！"); }
}

// ================= 美化版长图截取 =================
async function takeScreenshot(bm) {
    toastr.info("📸 正在绘制长图，请稍候...");
    if (typeof window.html2canvas === 'undefined') {
        try { await $.getScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"); } 
        catch (e) { return toastr.error("❌ 无法加载截图引擎，请检查网络。"); }
    }

    const safeText = applyTagFilter(bm.text || "*(内容丢失)*");
    const formattedText = typeof showdown !== 'undefined' ? new showdown.Converter().makeHtml(safeText) : escapeHtml(safeText);
    const initialChar = bm.char ? bm.char.charAt(0).toUpperCase() : 'A';
    
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed; top:0; left:0; width:100%; max-width:600px; padding:20px; background: linear-gradient(135deg, #1e1e2e, #11111b); z-index:-9999; box-sizing:border-box; font-family: sans-serif;';

    container.innerHTML = `
        <div style="background: rgba(49, 50, 68, 0.95); border-radius: 16px; padding: 25px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.05);">
            <div style="display: flex; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 15px;">
                <div style="background: var(--SmartThemeQuoteColor, #cba6f7); color: #000; width: 45px; height: 45px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 22px; margin-right: 15px;">
                    ${initialChar}
                </div>
                <div>
                    <div style="color: #cdd6f4; font-weight: bold; font-size: 1.2em;">${escapeHtml(bm.char || "未知")}</div>
                    <div style="color: #a6adc8; font-size: 0.85em; margin-top: 4px;">🕒 ${escapeHtml(bm.time)} | 💬 第 ${bm.floor !== undefined ? bm.floor : '?'} 楼</div>
                </div>
            </div>
            <div class="mes_text" style="color: #bac2de; font-size: 1.05em; line-height: 1.7; word-wrap: break-word;">${formattedText}</div>
        </div>
    `;
    document.body.appendChild(container);

    try {
        await new Promise(r => setTimeout(r, 600)); 
        const canvas = await window.html2canvas(container, { backgroundColor: '#11111b', scale: window.devicePixelRatio > 1 ? window.devicePixelRatio : 2, useCORS: true, logging: false });
        const url = canvas.toDataURL('image/png');
        const imgHtml = `<div style="text-align:center; max-height: 80vh; overflow-y: auto;"><p style="color: var(--SmartThemeQuoteColor); font-weight: bold; margin-bottom: 15px;">✅ 生成成功！长按或右键保存</p><img src="${url}" style="max-width: 100%; border-radius: 12px; box-shadow: 0 5px 20px rgba(0,0,0,0.5);" /></div>`;
        context.callGenericPopup(imgHtml, context.POPUP_TYPE.TEXT, "", { large: true, wide: true, okButton: false, cancelButton: "关闭" });
    } finally {
        document.body.removeChild(container);
    }
}

// ================= 数据保存逻辑 (修复名字抓取) =================
function getRealCharName(msg) {
    if (msg.is_user) return context.name1 || 'User';
    if (msg.name && msg.name !== 'SillyTavern System') return msg.name;
    return context.name2 || 'AI';
}

async function quickSaveLatest() {
    try {
        const lastMsgs = context.chat.slice(-1); 
        if (!lastMsgs || lastMsgs.length === 0) return toastr.warning("没有可收藏的消息。");
        const lastMsg = lastMsgs[0];
        const textToSave = (lastMsg.swipes && lastMsg.swipes.length > 0) ? lastMsg.swipes[lastMsg.swipe_id || 0] : lastMsg.mes;
        if (!textToSave || textToSave.trim() === "") return toastr.warning("消息为空。");
        
        const realChar = getRealCharName(lastMsg);
        
        extensionSettings[MODULE_NAME].bookmarks.push({ 
            time: new Date().toLocaleString(), 
            char: realChar, 
            role: lastMsg.is_user ? 'User' : 'AI', 
            text: textToSave, 
            floor: context.chat.length - 1, 
            chatId: context.getCurrentChatId() 
        });
        context.saveSettingsDebounced();
        toastr.success("✨ 成功收藏最新回复！");
    } catch (e) { toastr.error("❌ 收藏失败。"); }
}

// ================= 全新分组 UI (按楼层合并分页) =================
async function showBookmarksUI(bms, titleStr) {
    if (!bms || bms.length === 0) return toastr.info("📂 收藏夹是空的或没有匹配项。");
    
    // 1. 核心还原：使用原脚本的 Map 逻辑对同聊天、同角色、同楼层进行分组
    const groupsMap = new Map();
    bms.forEach(bm => {
        const dateStr = bm.time ? bm.time.split(' ')[0] : 'unknown';
        const key = (bm.chatId && bm.floor !== undefined) ? `${bm.chatId}_${bm.floor}` : `${bm.char}_${bm.floor}_${dateStr}`;
        if (!groupsMap.has(key)) {
            groupsMap.set(key, { char: bm.char || "未知", floor: bm.floor, time: bm.time || "未知", items:[] });
        }
        groupsMap.get(key).items.push(bm);
    });
    
    // 将分组结果转为数组并倒序（最新收藏在前）
    const groupedBookmarks = Array.from(groupsMap.values()).reverse();

    let htmlContent = `<div class="bkm-list-container">`;
    htmlContent += `<h3 class="bkm-title">${escapeHtml(titleStr)} <span class="bkm-count">(共 ${bms.length} 条)</span></h3>`;
    
    groupedBookmarks.forEach((group, gIndex) => {
        const floorText = group.floor !== undefined ? `第 ${group.floor} 楼` : `未知楼层`;
        const total = group.items.length;
        
        // 取第一条作为预览
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
                        <span class="bkm-preview-text">${previewText}</span>
                        ${total > 1 ? `<span class="bkm-version-badge">${total}个版本 <i class="fa-solid fa-chevron-down"></i></span>` : `<span class="bkm-version-badge single">展开 <i class="fa-solid fa-chevron-down"></i></span>`}
                    </div>
                </summary>
                
                <div class="bkm-versions-list">`;
        
        // 遍历该楼层下的所有分页版本
        group.items.forEach((item, iIndex) => {
            const safeItemText = applyTagFilter(item.text || "*(内容丢失)*");
            const formattedText = typeof showdown !== 'undefined' ? new showdown.Converter().makeHtml(safeItemText) : escapeHtml(safeItemText);
            
            htmlContent += `
                    <div class="bkm-version-item">
                        <div class="bkm-version-toolbar">
                            <span class="bkm-version-label">版本 #${iIndex + 1}</span>
                            <div class="bkm-btn-group">
                                <button class="bkm-icon-btn restore bkm-restore-btn" data-gindex="${gIndex}" data-iindex="${iIndex}">
                                    <i class="fa-solid fa-reply"></i> 导回
                                </button>
                                <button class="bkm-icon-btn shot bkm-shot-btn" data-gindex="${gIndex}" data-iindex="${iIndex}">
                                    <i class="fa-solid fa-image"></i> 长图
                                </button>
                            </div>
                        </div>
                        <div class="mes_text bkm-rendered-text">${formattedText}</div>
                    </div>`;
        });
        
        htmlContent += `
                </div>
            </details>
        </div>`;
    });
    htmlContent += `</div>`;

    await context.callGenericPopup(htmlContent, context.POPUP_TYPE.TEXT, "", {
        large: true, wide: true, cancelButton: "返回", okButton: false, allowVerticalScrolling: true,
        onOpen: (popup) => {
            // 事件绑定，通过 gIndex 和 iIndex 精准定位数据
            $('.bkm-shot-btn').on('click', async function(e) { 
                e.preventDefault(); e.stopPropagation();
                const gIdx = $(this).data('gindex');
                const iIdx = $(this).data('iindex');
                await takeScreenshot(groupedBookmarks[gIdx].items[iIdx]); 
            });
            $('.bkm-restore-btn').on('click', async function(e) { 
                e.preventDefault(); e.stopPropagation();
                const gIdx = $(this).data('gindex');
                const iIdx = $(this).data('iindex');
                await restoreBookmarkToChat(groupedBookmarks[gIdx].items[iIdx]); 
            });
        }
    });
}

// 多选管理 UI (用于删除等)
async function showMultiSelectUI(items, config) {
    let htmlContent = `<div class="bkm-list-container">`;
    htmlContent += `<h3 class="bkm-title" style="color: ${config.color || 'var(--SmartThemeQuoteColor)'};">${config.title}</h3>`;
    htmlContent += `<div class="bkm-grid"><button id="btn-sel-all" class="bkm-btn">✅ 全选</button><button id="btn-sel-none" class="bkm-btn">❌ 全不选</button></div><div class="bkm-flex-col">`;
    
    items.forEach((item, index) => {
        const formattedFullText = typeof showdown !== 'undefined' ? new showdown.Converter().makeHtml(item.fullText) : escapeHtml(item.fullText);
        htmlContent += `
        <div class="bkm-group-card" style="padding:12px;">
            <div style="display:flex; align-items:flex-start; gap: 10px;">
                <input type="checkbox" id="cb-${index}" class="bkm-sel-cb" data-value="${item.value}" style="width:20px; height:20px; margin-top:2px; flex-shrink:0;">
                <label for="cb-${index}" style="font-size: 0.95em; flex: 1; line-height:1.4; word-break: break-all; margin:0;">${item.label}</label>
            </div>
            <details class="bkm-details" style="margin-top: 8px; margin-left: 30px;">
                <summary style="font-size: 0.85em; color: var(--SmartThemeQuoteColor); opacity: 0.8;">(点击展开完整内容)</summary>
                <div class="mes_text bkm-rendered-text" style="margin-top: 8px;">${formattedFullText}</div>
            </details>
        </div>`;
    });
    htmlContent += `</div></div>`;
    
    let selectedSet = new Set();
    const choice = await context.callGenericPopup(htmlContent, context.POPUP_TYPE.TEXT, "", {
        okButton: config.okButtonText, cancelButton: "取消", large: true, wide: true,
        onOpen: () => {
            $('.bkm-sel-cb').on('change', function() { const val = $(this).data('value'); if ($(this).is(':checked')) selectedSet.add(val); else selectedSet.delete(val); });
            $('#btn-sel-all').on('click', () => { $('.bkm-sel-cb').prop('checked', true).each(function() { selectedSet.add($(this).data('value')); }); });
            $('#btn-sel-none').on('click', () => { $('.bkm-sel-cb').prop('checked', false); selectedSet.clear(); });
        }
    });
    if (choice === context.POPUP_RESULT.AFFIRMATIVE) return Array.from(selectedSet);
    return null;
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
                    <button id="btn-bkm-13" class="bkm-menu-btn"><i class="fa-solid fa-file-export"></i> 导出备份TXT</button>
                    
                    <button id="btn-bkm-19" class="bkm-menu-btn full-width"><i class="fa-solid fa-gear" style="color:#94e2d5;"></i> 标签过滤设置 (当前: ${extensionSettings[MODULE_NAME].filterTags})</button>
                </div>
            </div>
        `;

        const choice = await context.callGenericPopup(menuHtml, context.POPUP_TYPE.TEXT, "", {
            cancelButton: "退出", okButton: false,
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
                const realChar = getRealCharName(msg);
                allBms.push({ time: new Date().toLocaleString(), char: realChar, role: msg.is_user ? 'User' : 'AI', text: text, floor: mesId, chatId: context.getCurrentChatId() });
                context.saveSettingsDebounced();
                toastr.success(`✨ 成功收藏第 ${mesId} 楼！`);
                break;
            case 16:
                const range = await context.callGenericPopup("请输入要查阅的楼层号：", context.POPUP_TYPE.INPUT, "", { cancelButton: "取消" });
                if (!range || !context.chat[parseInt(range)]) { toastr.error("❌ 无效楼层！"); break; }
                const targetMsg = context.chat[parseInt(range)];
                const targetSwipes = targetMsg.swipes || [targetMsg.mes];
                const rChar = getRealCharName(targetMsg);
                // 构造成统一的格式方便传给 showBookmarksUI
                const swipeItems = targetSwipes.map((text, i) => ({ text: text, char: rChar, time: new Date().toLocaleString(), role: targetMsg.is_user ? 'User' : 'AI', floor: parseInt(range), chatId: context.getCurrentChatId() }));
                await showBookmarksUI(swipeItems, `第 ${range} 楼的历史生成`);
                break;
            case 17:
                const keyword = await context.callGenericPopup("请输入搜索关键字：", context.POPUP_TYPE.INPUT, "", { cancelButton: "取消" });
                if (!keyword || !keyword.trim()) break;
                const filtered = allBms.filter(b => (b.char && b.char.includes(keyword)) || (b.text && b.text.includes(keyword)));
                await showBookmarksUI([...filtered], `搜索结果: "${keyword}"`);
                break;
            case 12:
                await showBookmarksUI([...allBms], "所有收藏");
                break;
            case 18:
                if (allBms.length === 0) { toastr.info("收藏夹为空。"); break; }
                const itemsToDelete = allBms.map((bm, i) => ({ label: `[${escapeHtml(bm.char)} - 第${bm.floor}楼] ${escapeHtml(applyTagFilter(bm.text).substring(0, 25))}...`, value: i, fullText: applyTagFilter(bm.text) }));
                const indicesToDelete = await showMultiSelectUI(itemsToDelete, { title: '🗑️ 勾选要删除的收藏', okButtonText: '永久删除', color: '#ff6666' });
                if (indicesToDelete && indicesToDelete.length > 0) {
                    indicesToDelete.sort((a, b) => b - a).forEach(idx => allBms.splice(idx, 1));
                    context.saveSettingsDebounced();
                    toastr.success(`🗑️ 已成功删除 ${indicesToDelete.length} 条收藏！`);
                }
                break;
            case 13:
                if (allBms.length === 0) { toastr.info("收藏夹为空。"); break; }
                let txtContent = `=== 全局收藏夹导出 ===\n\n`;
                allBms.forEach((b, i) => { txtContent += `[#${i+1}] 角色: ${b.char} | 楼层: ${b.floor} | 时间: ${b.time}\n${applyTagFilter(b.text)}\n------------------------\n\n`; });
                try {
                    const blob = new Blob([txtContent], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url; a.download = `收藏夹备份_${Date.now()}.txt`;
                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                    toastr.success('📄 下载成功！');
                } catch (e) { toastr.error("❌ 下载失败。"); }
                break;
            case 19:
                const newTags = await context.callGenericPopup(`请输入要过滤的标签（如: think, thought）：`, context.POPUP_TYPE.INPUT, extensionSettings[MODULE_NAME].filterTags, { cancelButton: "取消" });
                if (newTags !== undefined) {
                    extensionSettings[MODULE_NAME].filterTags = newTags;
                    context.saveSettingsDebounced();
                    toastr.success("✅ 标签保存成功！");
                }
                break;
        }
    }
}

// ================= 悬浮球拖拽逻辑 =================
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

    const possiblePaths =['/scripts/extensions/third-party/shoucang/settings.html', '/scripts/extensions/third-party/SillyTavern-shoucang/settings.html', '/scripts/extensions/third-party/shoucang-main/settings.html'];
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
                $('#bkm-setting-remove-before').prop('checked', extensionSettings[MODULE_NAME].removeBeforeClosing).on('change', (e) => {
                    extensionSettings[MODULE_NAME].removeBeforeClosing = $(e.target).prop('checked'); context.saveSettingsDebounced();
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
const context = SillyTavern.getContext();
const { eventSource, event_types, extensionSettings, SlashCommandParser, SlashCommand } = context;

const MODULE_NAME = 'global_bookmarks_pro';
const defaultSettings = {
    showFloatingButton: true,
    filterTags: 'think',
    removeBeforeClosing: true, // 默认开启暴力过滤
    bookmarks:[],
    fabPosition: { top: '30%', left: '85%' } // 悬浮球默认位置
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
        // 第一步：过滤掉所有首尾完整的 <tag>...</tag>
        try {
            const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
            result = result.replace(regex, '');
        } catch (e) { }

        // 第二步：如果开启了暴力过滤，处理由于截断导致的残缺标签
        if (settings.removeBeforeClosing) {
            const closingTag = `</${tag}>`;
            const closingIndex = result.toLowerCase().indexOf(closingTag.toLowerCase());
            if (closingIndex !== -1) {
                // 如果只找到了 </tag>，把前面的全删掉（适用于思维链生成一半被截断）
                result = result.substring(closingIndex + closingTag.length);
            } else {
                const openIndex = result.toLowerCase().indexOf(`<${tag}`.toLowerCase());
                if (openIndex !== -1) {
                    // 如果只找到了 <tag>，把后面的全删掉（保留标签前面的干净文字）
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

// ================= 导回聊天功能 =================
async function restoreBookmarkToChat(bm) {
    try {
        const lastMessageId = context.chat.length - 1;
        let optionsHtml = `<div class="bkm-container"><h3 class="bkm-title">↩️ 请选择导回位置</h3><div class="bkm-flex-col">`;
        if (bm.floor !== undefined && bm.floor <= lastMessageId && bm.floor >= 0) {
            optionsHtml += `<button id="res-orig" class="bkm-btn" style="color:var(--SmartThemeLinkColor); font-weight:bold;">🔙 恢复到原楼层 (第 ${bm.floor} 楼) 的新分页</button>`;
        }
        if (lastMessageId >= 0) {
            optionsHtml += `<button id="res-last" class="bkm-btn">⬇️ 追加到最新楼层 (第 ${lastMessageId} 楼) 的新分页</button>`;
            optionsHtml += `<button id="res-custom" class="bkm-btn" style="color:var(--SmartThemeQuoteColor);">🔢 插入到自定义楼层的新分页</button>`;
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
            targetMsg.swipes.push(safeText);
            targetMsg.swipe_id = targetMsg.swipes.length - 1;
            targetMsg.mes = safeText;

            context.updateMessageBlock(targetFloor, targetMsg);
            context.saveChat();
            toastr.success(`✅ 已成功作为【第 ${targetMsg.swipes.length} 页】插入到第 ${targetFloor} 楼！`);
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
            toastr.success(`✅ 已成功作为新消息追加到末尾！`);
        }
    } catch (e) { toastr.error("❌ 导回失败！"); }
}

// ================= 美化版长图截取 =================
async function takeScreenshot(bm) {
    toastr.info("📸 正在绘制排版，请稍候...");
    if (typeof window.html2canvas === 'undefined') {
        try { await $.getScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"); } 
        catch (e) { return toastr.error("❌ 无法加载截图引擎，请检查网络。"); }
    }

    const safeText = applyTagFilter(bm.text || "*(内容丢失)*");
    const formattedText = typeof showdown !== 'undefined' ? new showdown.Converter().makeHtml(safeText) : escapeHtml(safeText);
    const initialChar = bm.char ? bm.char.charAt(0).toUpperCase() : 'A';
    
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed; top:0; left:0; width:100%; max-width:600px; padding:30px; background: linear-gradient(135deg, #1e1e2e, #11111b); z-index:-9999; box-sizing:border-box; font-family: sans-serif;';

    container.innerHTML = `
        <div style="background: rgba(49, 50, 68, 0.9); border-radius: 16px; padding: 25px; box-shadow: 0 15px 35px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.05);">
            <div style="display: flex; align-items: center; margin-bottom: 18px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 15px;">
                <div style="background: #cba6f7; color: #11111b; width: 45px; height: 45px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 22px; margin-right: 15px; box-shadow: 0 4px 10px rgba(203, 166, 247, 0.3);">
                    ${initialChar}
                </div>
                <div>
                    <div style="color: #cdd6f4; font-weight: bold; font-size: 1.2em; letter-spacing: 0.5px;">${escapeHtml(bm.char || "未知")}</div>
                    <div style="color: #a6adc8; font-size: 0.85em; margin-top: 3px;">🕒 ${escapeHtml(bm.time)} | 💬 ${escapeHtml(bm.role)} ${bm.floor !== undefined ? `| ${bm.floor}楼` : ''}</div>
                </div>
            </div>
            <div class="mes_text" style="color: #bac2de; font-size: 1.1em; line-height: 1.75; text-align: justify; word-wrap: break-word;">${formattedText}</div>
        </div>
    `;
    document.body.appendChild(container);

    try {
        await new Promise(r => setTimeout(r, 600)); 
        const canvas = await window.html2canvas(container, { backgroundColor: '#11111b', scale: window.devicePixelRatio > 1 ? window.devicePixelRatio : 2, useCORS: true, logging: false });
        const url = canvas.toDataURL('image/png');
        const imgHtml = `<div style="text-align:center; max-height: 80vh; overflow-y: auto;"><p style="color: var(--SmartThemeQuoteColor); font-weight: bold; margin-bottom: 10px;">✅ 生成成功！长按或右键保存</p><img src="${url}" style="max-width: 100%; border-radius: 12px; box-shadow: 0 5px 20px rgba(0,0,0,0.5);" /></div>`;
        context.callGenericPopup(imgHtml, context.POPUP_TYPE.TEXT, "", { large: true, wide: true, okButton: false, cancelButton: "关闭" });
    } finally {
        document.body.removeChild(container);
    }
}

// 快速保存最新消息
async function quickSaveLatest() {
    try {
        const lastMsgs = context.chat.slice(-1); 
        if (!lastMsgs || lastMsgs.length === 0) return toastr.warning("没有可收藏的消息。");
        const lastMsg = lastMsgs[0];
        const textToSave = (lastMsg.swipes && lastMsg.swipes.length > 0) ? lastMsg.swipes[lastMsg.swipe_id || 0] : lastMsg.mes;
        if (!textToSave || textToSave.trim() === "") return toastr.warning("消息为空。");
        
        extensionSettings[MODULE_NAME].bookmarks.push({ 
            time: new Date().toLocaleString(), char: context.name2 || "未知", role: lastMsg.is_user ? 'User' : (lastMsg.name || 'AI'), text: textToSave, floor: context.chat.length - 1, chatId: context.getCurrentChatId() 
        });
        context.saveSettingsDebounced();
        toastr.success("✨ 成功收藏最新回复！");
    } catch (e) { toastr.error("❌ 收藏失败。"); }
}

// ================= 多选/批量管理 UI =================
async function showMultiSelectUI(items, config) {
    let htmlContent = `<div style="max-height: 75vh; overflow-y: auto; padding: 5px; text-align: left;">`;
    htmlContent += `<h3 class="bkm-title" style="color: ${config.color || 'var(--SmartThemeQuoteColor)'};">${config.title}</h3>`;
    htmlContent += `<div class="bkm-grid" style="margin-bottom: 15px;"><button id="btn-sel-all" class="bkm-btn">✅ 全选</button><button id="btn-sel-none" class="bkm-btn">❌ 全不选</button></div><div class="bkm-flex-col">`;
    
    items.forEach((item, index) => {
        const formattedFullText = typeof showdown !== 'undefined' ? new showdown.Converter().makeHtml(item.fullText) : escapeHtml(item.fullText);
        htmlContent += `
        <div class="bkm-card" style="margin-bottom: 0; padding: 12px;">
            <div style="display:flex; align-items:flex-start;">
                <input type="checkbox" id="cb-${index}" class="bkm-sel-cb" data-value="${item.value}" style="width: 18px; height: 18px; margin-top: 2px; margin-right: 10px; flex-shrink:0; cursor:pointer;">
                <label for="cb-${index}" style="font-size: 0.95em; flex: 1; line-height:1.4; word-break: break-all; cursor:pointer; margin:0;">${item.label}</label>
            </div>
            <details style="margin-top: 8px; margin-left: 28px;">
                <summary style="cursor:pointer; font-size: 0.85em; color: var(--SmartThemeQuoteColor); opacity: 0.8;">(点击展开)</summary>
                <div class="mes_text" style="margin-top: 8px; font-size: 0.9em; line-height: 1.5; background: var(--SmartThemeBlurTintColor); padding: 10px; border-radius: 8px; max-height: 250px; overflow-y: auto;">${formattedFullText}</div>
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

// 高级分类浏览 UI
async function showBookmarksUI(bms, titleStr) {
    if (!bms || bms.length === 0) return toastr.info("📂 没有找到匹配的收藏。");
    
    let htmlContent = `<div style="max-height: 80vh; overflow-y: auto; padding: 5px; width: 100%; box-sizing: border-box; text-align:left;">`;
    htmlContent += `<h3 class="bkm-title">${escapeHtml(titleStr)} <span style="font-size:0.8em; opacity:0.7;">(共 ${bms.length} 条)</span></h3>`;
    
    bms.forEach((item, index) => {
        const safeItemText = applyTagFilter(item.text || "*(内容丢失)*");
        const formattedText = typeof showdown !== 'undefined' ? new showdown.Converter().makeHtml(safeItemText) : escapeHtml(safeItemText);
        let preview = escapeHtml(safeItemText.replace(/\n/g, ' ').substring(0, 40)) + "...";

        htmlContent += `
        <div class="bkm-card">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size: 0.85em; opacity: 0.8; margin-bottom: 10px; border-bottom: 1px dashed var(--SmartThemeBorderColor); padding-bottom: 8px;">
                <div><span style="color: var(--SmartThemeUserColor); font-weight: bold; font-size: 1.1em;">👤 ${escapeHtml(item.char)}</span> | 🕒 ${item.time}</div>
            </div>
            <details>
                <summary style="cursor: pointer; font-size: 0.95em; opacity: 0.9; outline: none;"><span style="opacity: 0.8;">${preview}</span></summary>
                <div style="margin-top: 12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div style="font-size:0.8em; color:var(--SmartThemeQuoteColor); opacity: 0.8;">[发送者: ${escapeHtml(item.role || "未知")}]</div>
                        <div style="display:flex; gap: 8px;">
                            <button class="bkm-action-btn restore bkm-restore-btn" data-idx="${index}">↩️ 导回聊天</button>
                            <button class="bkm-action-btn bkm-shot-btn" data-idx="${index}">📸 生成长图</button>
                        </div>
                    </div>
                    <div class="mes_text">${formattedText}</div>
                </div>
            </details>
        </div>`;
    });
    htmlContent += `</div>`;

    await context.callGenericPopup(htmlContent, context.POPUP_TYPE.TEXT, "", {
        large: true, wide: true, cancelButton: "返回", okButton: false,
        onOpen: (popup) => {
            $('.bkm-shot-btn').on('click', async function() { await takeScreenshot(bms[$(this).data('idx')]); });
            $('.bkm-restore-btn').on('click', async function() { await restoreBookmarkToChat(bms[$(this).data('idx')]); });
        }
    });
}

// 导出下载
async function downloadData(content, filename) {
    try {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        toastr.success('📄 下载成功！');
    } catch (e) { toastr.error("❌ 下载失败。"); }
}

// ================= 主菜单 =================
async function openMainMenu() {
    let keepRunning = true;
    while (keepRunning) {
        const menuHtml = `
            <h3 class="bkm-title" style="text-align:center;">🌟 全局收藏夹</h3>
            <div class="bkm-grid">
                <button id="btn-bkm-10" class="bkm-btn">🔖 快速收藏 (最新)</button>
                <button id="btn-bkm-11" class="bkm-btn">📌 收藏指定楼层</button>
                <button id="btn-bkm-16" class="bkm-btn">🔍 查阅历史生成</button>
                <button id="btn-bkm-17" class="bkm-btn">🔎 搜索收藏</button>
                <button id="btn-bkm-12" class="bkm-btn" style="grid-column: 1 / -1; color:var(--SmartThemeLinkColor);">📂 查看与浏览 (含导回功能)</button>
                <button id="btn-bkm-18" class="bkm-btn" style="grid-column: 1 / -1; color:#ff6666;">🗑️ 管理与删除</button>
                <button id="btn-bkm-13" class="bkm-btn" style="color:var(--SmartThemeLinkColor);">📤 导出与备份</button>
                <button id="btn-bkm-15" class="bkm-btn" style="color:var(--SmartThemeLinkColor);">📥 导入备份</button>
                <button id="btn-bkm-19" class="bkm-btn" style="grid-column: 1 / -1; color:var(--SmartThemeQuoteColor);">⚙️ 过滤标签设置 (如: think)</button>
            </div>
        `;

        const choice = await context.callGenericPopup(menuHtml, context.POPUP_TYPE.TEXT, "", {
            cancelButton: "退出", okButton: false,
            onOpen: (popup) => {
                $('.bkm-btn').on('click', function() { 
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
                allBms.push({ time: new Date().toLocaleString(), char: context.name2 || "未知", role: msg.is_user ? 'User' : (msg.name || 'AI'), text: text, floor: mesId, chatId: context.getCurrentChatId() });
                context.saveSettingsDebounced();
                toastr.success(`✨ 成功收藏第 ${mesId} 楼！`);
                break;
            case 16:
                const range = await context.callGenericPopup("请输入要查阅的楼层号：", context.POPUP_TYPE.INPUT, "", { cancelButton: "取消" });
                if (!range || !context.chat[parseInt(range)]) { toastr.error("❌ 无效楼层！"); break; }
                const targetMsg = context.chat[parseInt(range)];
                const targetSwipes = targetMsg.swipes || [targetMsg.mes];
                const swipeItems = targetSwipes.map((text, i) => ({ text: text, char: context.name2, time: new Date().toLocaleString(), role: targetMsg.is_user ? 'User' : (targetMsg.name || 'AI'), floor: parseInt(range) }));
                await showBookmarksUI(swipeItems, `第 ${range} 楼的历史生成 (${targetSwipes.length} 版)`);
                break;
            case 17:
                const keyword = await context.callGenericPopup("请输入搜索关键字：", context.POPUP_TYPE.INPUT, "", { cancelButton: "取消" });
                if (!keyword || !keyword.trim()) break;
                const filtered = allBms.filter(b => (b.char && b.char.includes(keyword)) || (b.text && b.text.includes(keyword)));
                await showBookmarksUI([...filtered].reverse(), `搜索结果: "${keyword}"`);
                break;
            case 12:
                await showBookmarksUI([...allBms].reverse(), "所有收藏 (最新优先)");
                break;
            case 18:
                if (allBms.length === 0) { toastr.info("收藏夹为空。"); break; }
                const itemsToDelete = allBms.map((bm, i) => ({ label: `[${escapeHtml(bm.char)}] ${escapeHtml(applyTagFilter(bm.text).substring(0, 30))}...`, value: i, fullText: applyTagFilter(bm.text) }));
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
                allBms.forEach((b, i) => { txtContent += `[#${i+1}] 角色: ${b.char} | 时间: ${b.time}\n${applyTagFilter(b.text)}\n------------------------\n\n`; });
                await downloadData(txtContent, `收藏夹备份_${Date.now()}.txt`);
                break;
            case 15:
                toastr.warning("暂未实现完整的文件读取解析，如有需要可以直接复制上述备份。");
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
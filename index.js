const context = SillyTavern.getContext();
const { eventSource, event_types, extensionSettings, SlashCommandParser, SlashCommand } = context;

const MODULE_NAME = 'global_bookmarks_pro';
const defaultSettings = {
    showFloatingButton: true,
    filterTags: 'think',
    removeBeforeClosing: true, // 默认开启暴力过滤
    bookmarks:[]
};

function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function applyTagFilter(text) {
    if (!text) return text;
    let result = text;
    const settings = extensionSettings[MODULE_NAME];
    const tags = (settings.filterTags || "think").split(',').map(t => t.trim()).filter(t => t);
    
    tags.forEach(tag => {
        if (settings.removeBeforeClosing) {
            const closingTag = `</${tag}>`;
            const closingIndex = result.toLowerCase().indexOf(closingTag.toLowerCase());
            if (closingIndex !== -1) {
                result = result.substring(closingIndex + closingTag.length);
            } else if (result.toLowerCase().includes(`<${tag}`.toLowerCase())) {
                result = ""; 
            }
        } else {
            try {
                const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
                result = result.replace(regex, '');
            } catch (e) { }
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

async function quickSaveLatest() {
    try {
        const lastMsgs = context.chat.slice(-1); 
        if (!lastMsgs || lastMsgs.length === 0) return toastr.warning("没有可收藏的消息。");
        const lastMsg = lastMsgs[0];
        
        const textToSave = (lastMsg.swipes && lastMsg.swipes.length > 0) ? lastMsg.swipes[lastMsg.swipe_id || 0] : lastMsg.mes;
        if (!textToSave || textToSave.trim() === "") return toastr.warning("消息为空。");

        const currentChar = context.name2 || "未知剧本";
        const currentChatId = context.getCurrentChatId();
        
        extensionSettings[MODULE_NAME].bookmarks.push({ 
            time: new Date().toLocaleString(), 
            char: currentChar, 
            role: lastMsg.is_user ? 'User' : (lastMsg.name || 'AI'), 
            text: textToSave, 
            floor: context.chat.length - 1, 
            chatId: currentChatId 
        });
        context.saveSettingsDebounced();
        toastr.success("✨ 成功收藏最新回复到全局！");
    } catch (e) { toastr.error("❌ 快速收藏失败。"); console.error(e); }
}

async function takeScreenshot(bm) {
    toastr.info("📸 正在绘制排版，请稍候...");
    if (typeof window.html2canvas === 'undefined') {
        try { await $.getScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"); } 
        catch (e) { return toastr.error("❌ 无法加载截图引擎，请检查网络。"); }
    }

    const safeText = applyTagFilter(bm.text || "*(内容丢失)*");
    const formattedText = typeof showdown !== 'undefined' ? new showdown.Converter().makeHtml(safeText) : escapeHtml(safeText);
    
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed; top:0; left:0; width:100%; max-width:600px; padding:20px; background-color:var(--SmartThemeBackgroundColor, #1a1b26); z-index:-9999; box-sizing:border-box;';

    container.innerHTML = `
        <div style="background: var(--SmartThemeBlurTintColor, rgba(30,30,46,0.8)); border: 1px solid var(--SmartThemeBorderColor, #313244); border-radius: 15px; padding: 25px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); color: var(--SmartThemeBodyColor, #cdd6f4);">
            <div style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid var(--SmartThemeBorderColor, #45475a); padding-bottom: 15px; margin-bottom: 20px;">
                <div>
                    <div style="font-size: 1.4em; font-weight: bold; color: var(--SmartThemeUserColor, #f5c2e7); margin-bottom: 8px;">👤 ${escapeHtml(bm.char || "未知角色")}</div>
                    <div style="font-size: 0.9em; opacity: 0.8;">发送者: ${escapeHtml(bm.role || "未知")}</div>
                </div>
                <div style="font-size: 0.85em; opacity: 0.7;">🕒 ${escapeHtml(bm.time || "未知时间")}</div>
            </div>
            <div class="mes_text" style="font-size: 1.1em; line-height: 1.7; text-align: justify; word-wrap: break-word;">${formattedText}</div>
        </div>
    `;
    document.body.appendChild(container);

    try {
        await new Promise(r => setTimeout(r, 600)); 
        const canvas = await window.html2canvas(container, { backgroundColor: '#1a1b26', scale: 2, useCORS: true, logging: false });
        const url = canvas.toDataURL('image/png');
        const imgHtml = `<div style="text-align:center; max-height: 80vh; overflow-y: auto;"><p style="color: var(--SmartThemeQuoteColor); font-weight: bold; margin-bottom: 10px;">✅ 生成成功！长按图片保存</p><img src="${url}" style="max-width: 100%; border-radius: 10px;" /></div>`;
        context.callGenericPopup(imgHtml, context.POPUP_TYPE.TEXT, "", { large: true, wide: true, okButton: false, cancelButton: "关闭" });
    } finally {
        document.body.removeChild(container);
    }
}

async function openMainMenu() {
    let keepRunning = true;
    while (keepRunning) {
        const menuHtml = `
            <h3 class="bkm-title">🌟 全局收藏夹</h3>
            <div class="bkm-grid">
                <button id="btn-bkm-quick" class="bkm-btn">🔖 快速收藏 (最新)</button>
                <button id="btn-bkm-view" class="bkm-btn" style="font-weight:bold; color:var(--SmartThemeLinkColor, #66ccff);">📂 浏览所有收藏</button>
                <button id="btn-bkm-del" class="bkm-btn" style="grid-column: 1 / -1; justify-content: center; color:#ff6666;">🗑️ 清空所有收藏 (危险)</button>
            </div>
        `;

        const choice = await context.callGenericPopup(menuHtml, context.POPUP_TYPE.TEXT, "", {
            cancelButton: "退出", okButton: false,
            onOpen: async (popup) => {
                $('#btn-bkm-quick').on('click', () => popup.complete(1));
                $('#btn-bkm-view').on('click', () => popup.complete(2));
                $('#btn-bkm-del').on('click', () => popup.complete(3));
            }
        });

        if (!choice || choice === context.POPUP_RESULT.CANCELLED) { keepRunning = false; break; }

        switch (choice) {
            case 1: await quickSaveLatest(); break;
            case 2: await showBookmarksList(); break;
            case 3:
                const confirm = await context.callGenericPopup("确定要清空所有收藏吗？", context.POPUP_TYPE.CONFIRM);
                if(confirm === context.POPUP_RESULT.AFFIRMATIVE) {
                    extensionSettings[MODULE_NAME].bookmarks =[];
                    context.saveSettingsDebounced();
                    toastr.success("已清空。");
                }
                break;
        }
    }
}

async function showBookmarksList() {
    const bms = [...extensionSettings[MODULE_NAME].bookmarks].reverse();
    if(bms.length === 0) return toastr.info("收藏夹为空。");

    let html = `<div style="max-height: 75vh; overflow-y: auto; text-align: left; padding: 10px;">`;
    html += `<h3 class="bkm-title">📂 我的收藏 (${bms.length}条)</h3>`;
    
    bms.forEach((bm, idx) => {
        const actualIdx = extensionSettings[MODULE_NAME].bookmarks.length - 1 - idx;
        const filteredText = applyTagFilter(bm.text || "");
        let preview = escapeHtml(filteredText.replace(/\n/g, ' ').substring(0, 40)) + "...";

        html += `
        <div class="bkm-card">
            <div style="font-size: 0.85em; opacity: 0.8; margin-bottom: 8px;">👤 <b>${escapeHtml(bm.char)}</b> | 🕒 ${bm.time}</div>
            <details>
                <summary style="cursor: pointer; opacity: 0.9; color: var(--SmartThemeQuoteColor);">${preview}</summary>
                <div style="margin-top: 10px; line-height: 1.5;">${escapeHtml(filteredText)}</div>
                <div style="margin-top: 10px; display:flex; gap:10px;">
                    <button class="bkm-action-btn bkm-shot-btn" data-idx="${actualIdx}">📸 生成长图</button>
                    <button class="bkm-action-btn bkm-del-btn" style="color:#ff6666; border-color:#ff6666;" data-idx="${actualIdx}">🗑️ 删除</button>
                </div>
            </details>
        </div>`;
    });
    html += `</div>`;

    await context.callGenericPopup(html, context.POPUP_TYPE.TEXT, "", {
        large: true, wide: true, cancelButton: "返回", okButton: false,
        onOpen: (popup) => {
            $('.bkm-shot-btn').on('click', async function() { await takeScreenshot(extensionSettings[MODULE_NAME].bookmarks[$(this).data('idx')]); });
            $('.bkm-del-btn').on('click', function() {
                extensionSettings[MODULE_NAME].bookmarks.splice($(this).data('idx'), 1);
                context.saveSettingsDebounced();
                toastr.success("删除成功！");
                popup.complete(0); 
            });
        }
    });
}

function toggleFAB() {
    if (extensionSettings[MODULE_NAME].showFloatingButton) {
        $('#bkm-fab-container').css('display', 'flex');
    } else {
        $('#bkm-fab-container').css('display', 'none');
    }
}

async function initUI() {
    loadSettings();

    // 动态匹配你的 Github 仓库名字 (shoucang) 确保能找到设置文件
    const possiblePaths =[
        '/scripts/extensions/third-party/shoucang/settings.html',
        '/scripts/extensions/third-party/SillyTavern-shoucang/settings.html',
        '/scripts/extensions/third-party/shoucang-main/settings.html'
    ];

    let settingsHtml = null;
    for (const path of possiblePaths) {
        try {
            settingsHtml = await $.get(path);
            if (settingsHtml) break;
        } catch (e) { continue; }
    }

    if (settingsHtml) {
        $('#extensions_settings').append(settingsHtml);
        $('#bkm-setting-show-fab').prop('checked', extensionSettings[MODULE_NAME].showFloatingButton).on('change', (e) => {
            extensionSettings[MODULE_NAME].showFloatingButton = $(e.target).prop('checked');
            context.saveSettingsDebounced();
            toggleFAB();
        });
        $('#bkm-setting-filter-tags').val(extensionSettings[MODULE_NAME].filterTags).on('input', (e) => {
            extensionSettings[MODULE_NAME].filterTags = $(e.target).val();
            context.saveSettingsDebounced();
        });
        $('#bkm-setting-remove-before').prop('checked', extensionSettings[MODULE_NAME].removeBeforeClosing).on('change', (e) => {
            extensionSettings[MODULE_NAME].removeBeforeClosing = $(e.target).prop('checked');
            context.saveSettingsDebounced();
        });
    }

    // 独立注入悬浮球，不再受前面的加载影响
    if ($('#bkm-fab-container').length === 0) {
        $('body').append(`
            <div id="bkm-fab-container" class="has-tooltip" data-tooltip="全局收藏夹">
                <i class="fa-solid fa-star"></i>
            </div>
        `);
        $('#bkm-fab-container').on('click', openMainMenu);
    }
    toggleFAB();

    // 注册 QR 栏斜杠命令
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'bkm_latest',
        callback: async () => { await quickSaveLatest(); return ""; },
        returns: '无返回值',
        helpString: '快速收藏聊天记录中的最后一条消息。'
    }));
}

eventSource.on(event_types.APP_READY, initUI);
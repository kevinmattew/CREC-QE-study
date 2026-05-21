// ==UserScript==
// @name         中国中铁安全生产监督管理系统挂课助手 v5.20
// @updateURL
// @downloadURL
// @namespace    http://tampermonkey.net/
// @version      5.20.0
// @description  全自动刷课助手 - 增加详细调试信息
// @author       saiken
// @match        https://psec.crec.cn/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// ==/UserScript==

(function() {
    'use strict';

    let currentStepText = '等待中...';
    let nextStepText = '';
    let debugInfo = '';

    const Logger = {
        log(...args) {
            console.log('[安全刷课]', ...args);
        },
        notify(msg) {
            try {
                GM_notification({ title: '安全刷课', text: msg, timeout: 3000 });
            } catch (e) {}
            this.log(msg);
        },
        setStep(step, next) {
            currentStepText = step;
            nextStepText = next || '';
            this.log('步骤:', step, '| 下一步:', next);
        },
        setDebug(info) {
            debugInfo = info;
        }
    };

    const Utils = {
        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },
        randomInt(min, max) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        },
        // 简单而安全的点击函数
        clickElement(element) {
            if (!element) return false;

            Logger.log(`尝试点击元素: ${element.tagName} ${element.className}`);

            // 先尝试原生click() - 这是最可靠的
            element.click();

            // 尝试聚焦
            if (element.focus) {
                try {
                    element.focus();
                } catch (e) {
                    // 忽略聚焦错误
                }
            }

            Logger.log(`点击完成`);
            return true;
        },

        // 获取当前登录用户名
        getCurrentUser() {
            try {
                // 检查是否有用户手动选择的用户
                try {
                    const selectedUser = GM_getValue('selected_user', null);
                    if (selectedUser) {
                        return selectedUser;
                    }
                } catch (e) {
                    // 忽略 GM 错误
                }

                // 尝试查找用户名元素
                const userElements = document.querySelectorAll('.user-name, .username, [class*="user"]');
                for (const el of userElements) {
                    const text = el.textContent?.trim();
                    if (text && text.length > 1 && text.length < 50 && !text.includes('首页') && !text.includes('退出')) {
                        return text;
                    }
                }

                // 尝试从页面内容中检测
                const pageText = document.body.textContent || '';
                const userMatch = pageText.match(/(?:用户|账号|姓名)[:：]?\s*([^\s，。、]{2,20})/);
                if (userMatch) {
                    return userMatch[1];
                }

                // 默认用户名
                return '默认用户';
            } catch (e) {
                return '默认用户';
            }
        },

        // 获取所有签名数据（按用户分组存储）
        getAllSignatures() {
            try {
                return GM_getValue('all_signatures', {});
            } catch (e) {
                return {};
            }
        },

        // 获取当前用户的签名
        getSignatures() {
            const allSigs = this.getAllSignatures();
            const currentUser = this.getCurrentUser();
            return allSigs[currentUser] || [];
        },

        // 保存签名到当前用户
        saveSignature(signature) {
            const allSigs = this.getAllSignatures();
            const currentUser = this.getCurrentUser();

            if (!allSigs[currentUser]) {
                allSigs[currentUser] = [];
            }

            if (allSigs[currentUser].length < 3) {
                allSigs[currentUser].push(signature);
                GM_setValue('all_signatures', allSigs);
                Logger.log(`已为用户 "${currentUser}" 保存签名 (${allSigs[currentUser].length}/3)`);
            }
        },

        // 清空当前用户的签名
        clearSignatures() {
            const allSigs = this.getAllSignatures();
            const currentUser = this.getCurrentUser();
            allSigs[currentUser] = [];
            GM_setValue('all_signatures', allSigs);
            Logger.log(`已清空用户 "${currentUser}" 的签名`);
        },

        // 清空所有签名
        clearAllSignatures() {
            GM_setValue('all_signatures', {});
            Logger.log('已清空所有签名');
        },
        getSpeed() {
            return GM_getValue('video_speed', 1.0);
        },
        setSpeed(speed) {
            GM_setValue('video_speed', speed);
        },
        getProgress() {
            try {
                return GM_getValue('study_progress', {
                    lastUpdated: 0,
                    currentPage: 1,
                    totalPages: 1,
                    pages: {}
                });
            } catch (e) {
                return {
                    lastUpdated: 0,
                    currentPage: 1,
                    totalPages: 1,
                    pages: {}
                };
            }
        },
        saveProgress(progress) {
            GM_setValue('study_progress', {
                ...progress,
                lastUpdated: Date.now()
            });
        },
        markVideoCompleted(videoId, pageNum) {
            const progress = this.getProgress();
            if (!progress.pages[pageNum]) {
                progress.pages[pageNum] = { videos: [] };
            }
            const video = progress.pages[pageNum].videos.find(v => v.id === videoId);
            if (video) {
                video.status = 'completed';
            } else {
                progress.pages[pageNum].videos.push({
                    id: videoId,
                    status: 'completed'
                });
            }
            this.saveProgress(progress);
        },
        isVideoCompleted(videoId, pageNum) {
            const progress = this.getProgress();
            if (!progress.pages[pageNum]) return false;
            const video = progress.pages[pageNum].videos.find(v => v.id === videoId);
            return video?.status === 'completed';
        },
        setCurrentPage(pageNum) {
            const progress = this.getProgress();
            progress.currentPage = pageNum;
            this.saveProgress(progress);
        },
        setTotalPages(total) {
            const progress = this.getProgress();
            progress.totalPages = total;
            this.saveProgress(progress);
        },
        clearProgress() {
            GM_setValue('study_progress', {
                lastUpdated: 0,
                currentPage: 1,
                totalPages: 1,
                pages: {}
            });
        },
        getCompletedCount() {
            const progress = this.getProgress();
            let count = 0;
            for (const pageNum of Object.keys(progress.pages)) {
                count += progress.pages[pageNum].videos.filter(v => v.status === 'completed').length;
            }
            return count;
        }
    };

    const SmartDetector = {
        isModalActive() {
            const modals = document.querySelectorAll('.crec-modal-root');
            for (const modal of modals) {
                if (modal.style.display !== 'none') {
                    return true;
                }
            }
            return false;
        },
        isVideoPage() {
            return !!document.querySelector('video') || !!document.querySelector('.video-js');
        },
        isVideoListPage() {
            return !!document.querySelector('.is-it-completed2');
        },
        findUnlearnedCard() {
            const spans = document.querySelectorAll('span.is-it-completed2');
            for (const span of spans) {
                if (span.textContent && span.textContent.trim() === '未学习') {
                    let card = span.closest('.my-card, .crec-card, [class*="card"]');
                    if (!card) {
                        card = span.closest('div');
                    }
                    return card;
                }
            }
            return null;
        },
        // 优先检测签名弹窗
        findSignatureCanvas() {
            // 方法1: 直接查找canvas元素（在签名弹窗中）
            const canvases = document.querySelectorAll('canvas');
            for (const canvas of canvases) {
                // 检查canvas尺寸（大尺寸canvas通常是签名画布）
                if (canvas.width >= 300 && canvas.height >= 150) {
                    // 检查父级容器是否包含"签名"
                    const parent = canvas.closest('.crec-modal-body, .crec-modal-content, .crec-modal-root');
                    if (parent) {
                        const modalText = parent.textContent || '';
                        if (modalText.includes('签名')) {
                            Logger.log('找到签名画布: canvas尺寸', canvas.width, 'x', canvas.height);
                            return canvas;
                        }
                    }
                }
            }

            // 方法2: 在modal中查找签名canvas
            const modals = document.querySelectorAll('.crec-modal-root');
            for (const modal of modals) {
                const style = window.getComputedStyle(modal);
                // 检查modal是否可见
                const isVisible = style.display !== 'none' &&
                                 style.visibility !== 'hidden' &&
                                 parseFloat(style.opacity) > 0;

                if (isVisible) {
                    const bodyText = modal.textContent || '';
                    // 确认是签名弹窗
                    if (bodyText.includes('签名') && !bodyText.includes('请先录制')) {
                        const canvas = modal.querySelector('canvas');
                        if (canvas) {
                            Logger.log('在签名modal中找到canvas');
                            return canvas;
                        }
                    }
                }
            }

            return null;
        },

        // 验证按钮检测（排除签名弹窗）
        findVerificationButton() {
            const modals = document.querySelectorAll('.crec-modal-root');
            for (const modal of modals) {
                const style = window.getComputedStyle(modal);
                // 检查modal是否可见
                const isVisible = style.display !== 'none' &&
                                 style.visibility !== 'hidden' &&
                                 parseFloat(style.opacity) > 0;

                if (isVisible) {
                    const bodyText = modal.textContent || '';

                    // 排除签名弹窗
                    if (bodyText.includes('签名')) {
                        continue;
                    }

                    // 检测挂机验证弹窗
                    if (bodyText.includes('挂机') || bodyText.includes('验证')) {
                        Logger.log('找到验证弹窗');

                        // 优先找"确认"按钮
                        const buttons = modal.querySelectorAll('button');
                        for (const btn of buttons) {
                            const btnText = (btn.textContent || '').replace(/\s/g, '');
                            if (btnText.includes('确认') || btnText.includes('确定')) {
                                return btn;
                            }
                        }

                        // 找主按钮
                        const primaryBtn = modal.querySelector('button.crec-btn-primary');
                        if (primaryBtn) {
                            return primaryBtn;
                        }

                        // 找最后一个按钮
                        if (buttons.length > 1) {
                            return buttons[buttons.length - 1];
                        }
                    }
                }
            }
            return null;
        },

        findSaveSignatureButton() {
            const modals = document.querySelectorAll('.crec-modal-root');
            for (const modal of modals) {
                const style = window.getComputedStyle(modal);
                if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
                    const bodyText = modal.textContent || '';
                    if (bodyText.includes('签名')) {
                        const buttons = modal.querySelectorAll('button');
                        for (const btn of buttons) {
                            const btnText = (btn.textContent || '').replace(/\s/g, '');
                            if (btnText.includes('保存签名') || btnText.includes('保存')) {
                                return btn;
                            }
                        }
                    }
                }
            }

            const canvas = this.findSignatureCanvas();
            if (canvas) {
                const buttons = canvas.closest('.crec-modal-body, .crec-modal-content')?.querySelectorAll('button');
                if (buttons) {
                    for (const btn of buttons) {
                        const btnText = (btn.textContent || '').replace(/\s/g, '');
                        if (btnText.includes('保存签名') || btnText.includes('保存')) {
                            return btn;
                        }
                    }
                }
            }

            return null;
        },
        findVideoElement() {
            const vjsVideo = document.querySelector('video.vjs-tech, #vjs_video_3_html5_api');
            if (vjsVideo) return vjsVideo;
            const video = document.querySelector('video');
            if (video) return video;
            const vjs = document.querySelector('.video-js video');
            if (vjs) return vjs;
            return null;
        },
        getVideoJSPlayer() {
            if (window.videojs) {
                const playerEl = document.querySelector('.video-js');
                if (playerEl && playerEl.id) {
                    return window.videojs.getPlayer(playerEl.id);
                }
            }
            return null;
        },
        getCurrentPage() {
            const pageInfo = document.querySelector('.ant-pagination-item-active, .current-page');
            if (pageInfo) {
                const text = pageInfo.textContent || pageInfo.getAttribute('aria-current');
                const match = String(text).match(/\d+/);
                if (match) return parseInt(match[0]);
            }

            const pagination = document.querySelector('.ant-pagination');
            if (pagination) {
                const items = pagination.querySelectorAll('.ant-pagination-item');
                for (const item of items) {
                    if (item.classList.contains('ant-pagination-item-active')) {
                        const match = item.textContent.match(/\d+/);
                        if (match) return parseInt(match[0]);
                    }
                }
            }

            return Utils.getProgress().currentPage || 1;
        },
        getTotalPages() {
            const pagination = document.querySelector('.ant-pagination');
            if (pagination) {
                const totalText = pagination.querySelector('.ant-pagination-total-text');
                if (totalText) {
                    const match = totalText.textContent.match(/(\d+)/);
                    if (match) return parseInt(match[1]);
                }

                const lastPage = pagination.querySelector('.ant-pagination-item:last-child');
                if (lastPage) {
                    const match = lastPage.textContent.match(/\d+/);
                    if (match) return parseInt(match[0]);
                }
            }

            return Utils.getProgress().totalPages || 1;
        },
        getNextPageButton() {
            const pagination = document.querySelector('.ant-pagination');
            if (pagination) {
                const nextBtn = pagination.querySelector('.ant-pagination-next');
                if (nextBtn && !nextBtn.classList.contains('ant-pagination-disabled')) {
                    return nextBtn;
                }
            }
            return null;
        },
        getVideoId(cardElement) {
            if (!cardElement) return null;

            const dataId = cardElement.getAttribute('data-id') || cardElement.getAttribute('data-v-512c9fca');
            if (dataId) return dataId;

            const link = cardElement.querySelector('a, [onclick]');
            if (link) {
                const onClick = link.getAttribute('onclick') || '';
                const match = onClick.match(/\d+/);
                if (match) return match[0];
            }

            const textContent = cardElement.textContent || '';
            const hash = textContent.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            return `video_${hash}`;
        },
        findAllUnlearnedCards() {
            const cards = [];
            const spans = document.querySelectorAll('span.is-it-completed2');
            for (const span of spans) {
                if (span.textContent && span.textContent.trim() === '未学习') {
                    const card = span.closest('.my-card, .crec-card, [class*="card"]') || span.closest('div');
                    if (card) {
                        cards.push(card);
                    }
                }
            }
            return cards;
        },
        isHomePage() {
            const isVideoPage = this.isVideoPage();
            const isVideoListPage = this.isVideoListPage();
            const hasMenu = !!document.querySelector('.crec-menu, .crec-portal');
            const isHome = !isVideoPage && !isVideoListPage && hasMenu;

            Logger.setDebug(`页面检测: 视频页=${isVideoPage} 列表页=${isVideoListPage} 有菜单=${hasMenu}`);

            return isHome;
        },
        findMenuSubmenu(text) {
            // 查找菜单项的标题: div.crec-menu-submenu-title (这才是真正可点击的元素)
            const submenuTitles = document.querySelectorAll('div.crec-menu-submenu-title');
            for (const title of submenuTitles) {
                const menuText = title.textContent?.trim();
                if (menuText && menuText.includes(text)) {
                    Logger.setDebug(`找到子菜单标题: ${menuText}`);
                    return title;
                }
            }
            Logger.setDebug(`未找到带"${text}"的子菜单标题，查找li...`);
            const submenus = document.querySelectorAll('li.crec-menu-submenu');
            for (const submenu of submenus) {
                const menuText = submenu.textContent?.trim();
                if (menuText && menuText.includes(text)) {
                    // 从li中找到内部的title div
                    const titleEl = submenu.querySelector('div.crec-menu-submenu-title');
                    if (titleEl) {
                        Logger.setDebug('找到li，返回内部title');
                        return titleEl;
                    }
                    return submenu;
                }
            }
            return null;
        },
        findMenuItem(text) {
            // 查找普通菜单项: li.crec-menu-item，或者查找a标签等
            const items = document.querySelectorAll('li.crec-menu-item, div.crec-menu-item, a.crec-menu-item');
            for (const item of items) {
                const itemText = item.textContent?.trim();
                if (itemText && itemText.includes(text)) {
                    Logger.setDebug(`找到菜单项: ${itemText} (${item.tagName})`);
                    return item;
                }
            }
            // 查找所有可能的元素
            const all = document.querySelectorAll('*');
            for (const el of all) {
                const elText = el.textContent?.trim();
                if (elText && elText.includes(text)) {
                    const tagName = el.tagName?.toLowerCase();
                    if (['a', 'div', 'li', 'span', 'button'].includes(tagName)) {
                        Logger.setDebug(`通过备用找到: ${elText} (${tagName})`);
                        return el;
                    }
                }
            }
            return null;
        },
        findNavigationItem(text) {
            let el = this.findMenuSubmenu(text) || this.findMenuItem(text);
            if (el) return el;

            // 备用方案
            const allElements = document.querySelectorAll('*');
            for (const e of allElements) {
                const elText = e.textContent?.trim();
                if (elText === text) {
                    return e.closest('li, div, a, button') || e;
                }
            }
            return null;
        }
    };

    const VideoController = {
        async ensurePlaying() {
            const video = SmartDetector.findVideoElement();
            if (!video) return;

            const speed = Utils.getSpeed();
            if (video.playbackRate !== speed) {
                video.playbackRate = speed;
            }

            // 如果视频暂停或结束，尝试播放
            if (video.paused || video.ended) {
                Logger.log(`视频状态: paused=${video.paused} ended=${video.ended}，尝试播放`);

                // 方法1: 尝试Video.js API
                const player = SmartDetector.getVideoJSPlayer();
                if (player) {
                    try {
                        player.play();
                        Logger.log('使用Video.js API播放成功');
                        return;
                    } catch (e) {
                        Logger.log('Video.js API播放失败:', e.message);
                    }
                }

                // 方法2: 直接播放
                try {
                    await video.play();
                    Logger.log('video.play()成功');
                    return;
                } catch (e) {
                    Logger.log('video.play()失败:', e.message);
                }

                // 方法3: 点击播放按钮
                const playBtn = document.querySelector('.vjs-big-play-button');
                if (playBtn) {
                    Logger.log('点击大播放按钮');
                    playBtn.click();
                    await Utils.delay(500);
                    return;
                }

                // 方法4: 点击播放控制按钮
                const playControl = document.querySelector('.vjs-play-control, .vjs-playing-control, .vjs-play-button');
                if (playControl) {
                    Logger.log('点击播放控制按钮');
                    playControl.click();
                    await Utils.delay(500);
                    return;
                }

                // 方法5: 直接点击视频元素
                Logger.log('直接点击视频元素');
                video.click();
            }
        },

        getVideoState() {
            const video = SmartDetector.findVideoElement();
            if (!video) return null;

            return {
                paused: video.paused,
                ended: video.ended,
                currentTime: video.currentTime,
                duration: video.duration,
                playbackRate: video.playbackRate,
                readyState: video.readyState,
                src: video.src
            };
        }
    };

    const AutoSignHandler = {
        recordedPoints: [],
        isRecording: false,
        isSigning: false,

        recordSignature() {
            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999999;display:flex;align-items:center;justify-content:center;';
            modal.innerHTML = `
                <div style="background:white;border-radius:15px;padding:25px;max-width:500px;">
                    <h3 style="margin:0 0 15px;">签名录制 ${Utils.getSignatures().length}/3</h3>
                    <div style="font-size:12px;color:#666;margin-bottom:10px;">提示：在下方区域内按住鼠标左键并移动签名</div>
                    <canvas id="sign-canvas" width="450" height="200" style="border:1px dashed #ccc;border-radius:8px;background:white;cursor:crosshair;"></canvas>
                    <div style="margin-top:15px;display:flex;gap:10px;">
                        <button id="clear-btn" style="flex:1;padding:10px;border:1px solid #ccc;border-radius:6px;background:#f5f5f5;">清除</button>
                        <button id="save-btn" style="flex:2;padding:10px;border:0;border-radius:6px;background:#1890ff;color:white;">保存此签名</button>
                    </div>
                    <button id="close-btn" style="width:100%;margin-top:10px;padding:8px;border:0;background:#eee;border-radius:6px;">关闭</button>
                </div>
            `;
            document.body.appendChild(modal);

            const canvas = modal.querySelector('#sign-canvas');
            const ctx = canvas.getContext('2d');
            const points = [];

            let isDrawing = false;

            canvas.addEventListener('mousedown', (e) => {
                e.preventDefault();
                isDrawing = true;
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                points.push({ type: 'start', x, y, time: Date.now() });
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x, y);
                ctx.stroke();
            });

            canvas.addEventListener('mousemove', (e) => {
                if (!isDrawing) return;
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                points.push({ type: 'move', x, y, time: Date.now() });
                ctx.lineTo(x, y);
                ctx.stroke();
            });

            canvas.addEventListener('mouseup', () => {
                if (isDrawing) {
                    isDrawing = false;
                    if (points.length > 0) {
                        const last = points[points.length - 1];
                        points.push({ type: 'end', x: last.x, y: last.y, time: Date.now() });
                    }
                }
            });

            canvas.addEventListener('mouseleave', () => {
                if (isDrawing) {
                    isDrawing = false;
                    if (points.length > 0) {
                        const last = points[points.length - 1];
                        points.push({ type: 'end', x: last.x, y: last.y, time: Date.now() });
                    }
                }
            });

            modal.querySelector('#clear-btn').onclick = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                points.length = 0;
            };

            modal.querySelector('#save-btn').onclick = () => {
                if (points.length < 10) {
                    alert('请先签个名！');
                    return;
                }
                Utils.saveSignature({ points: [...points], width: canvas.width, height: canvas.height });
                Logger.notify(`签名已保存 (${Utils.getSignatures().length}/3)`);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                points.length = 0;
                modal.querySelector('h3').textContent = `签名录制 ${Utils.getSignatures().length}/3`;
            };

            modal.querySelector('#close-btn').onclick = () => modal.remove();
        },

        async autoSign() {
            // 检查是否正在签名
            if (this.isSigning) {
                Logger.log('正在签名中，跳过本次');
                return;
            }

            // 获取签名数据
            const sigs = Utils.getSignatures();
            if (sigs.length === 0) {
                Logger.notify('请先录制签名！');
                return;
            }

            // 查找签名画布
            const canvas = SmartDetector.findSignatureCanvas();
            if (!canvas) {
                Logger.log('未找到签名画布');
                return;
            }

            // 设置签名标志
            this.isSigning = true;
            Logger.notify('正在自动签名...');

            try {
                // 获取随机签名
                const signature = sigs[Math.floor(Math.random() * sigs.length)];
                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / (signature.width || canvas.width);
                const scaleY = canvas.height / (signature.height || canvas.height);

                let lastTime = signature.points[0]?.time || Date.now();

                // 回放签名轨迹
                for (const point of signature.points) {
                    const delay = Math.min(Math.max(0, point.time - lastTime), 30);
                    await Utils.delay(delay);
                    lastTime = point.time;

                    const x = point.x * scaleX + rect.left;
                    const y = point.y * scaleY + rect.top;

                    const eventProps = { clientX: x, clientY: y, bubbles: true, cancelable: true };

                    if (point.type === 'start') {
                        canvas.dispatchEvent(new MouseEvent('mousedown', eventProps));
                    } else if (point.type === 'move') {
                        canvas.dispatchEvent(new MouseEvent('mousemove', eventProps));
                    } else if (point.type === 'end') {
                        canvas.dispatchEvent(new MouseEvent('mouseup', eventProps));
                    }
                }

                await Utils.delay(500);

                // 点击保存按钮
                const saveBtn = SmartDetector.findSaveSignatureButton();
                if (saveBtn) {
                    Logger.log('点击保存签名按钮');
                    saveBtn.click();

                    // 等待保存完成
                    await Utils.delay(1000);

                    // 签名保存后，查找并点击关闭/返回按钮
                    Logger.log('签名已保存，查找关闭按钮...');

                    // 等待弹窗关闭
                    await Utils.delay(2000);

                    // 尝试查找关闭按钮
                    const closeBtn = document.querySelector(
                        '.crec-modal-close, .crec-modal-footer button, button[aria-label="Close"], ' +
                        '[class*="modal"] button, [class*="close"], ' +
                        'button:not([class])'
                    );

                    if (closeBtn) {
                        Logger.log('找到关闭按钮，尝试关闭弹窗');
                        closeBtn.click();
                        await Utils.delay(1000);
                    }

                    // 如果弹窗还没关闭，查找确定/OK按钮
                    const okBtn = document.querySelector(
                        '.crec-btn-primary, .crec-modal-footer button:last-child, ' +
                        'button[class*="primary"], button:contains("确定")'
                    );
                    if (okBtn) {
                        Logger.log('找到确定按钮，点击确认');
                        okBtn.click();
                        await Utils.delay(1000);
                    }

                    Logger.notify('签名完成并关闭弹窗！');
                } else {
                    Logger.log('未找到保存按钮');
                }
            } catch (error) {
                Logger.log('签名过程发生错误:', error.message);
            } finally {
                // 确保签名标志被重置
                this.isSigning = false;
                Logger.log('签名标志已重置');
            }
        }
    };

    const LessonController = {
        lastActionTime: 0,
        lastVideoEndTime: 0,

        async process() {
            const now = Date.now();
            if (now - this.lastActionTime < 5000) return;

            if (SmartDetector.isModalActive()) return;

            if (SmartDetector.isVideoPage()) {
                await this.handleVideoPage();
                return;
            }

            if (SmartDetector.isVideoListPage()) {
                await this.handleVideoListPage();
            }
        },

        async handleVideoPage() {
            const video = SmartDetector.findVideoElement();
            if (!video) return;

            await VideoController.ensurePlaying();

            if (video.ended && Date.now() - this.lastVideoEndTime > 5000) {
                this.lastVideoEndTime = Date.now();
                Logger.notify('视频播放完成！');
                await Utils.delay(3000);

                const signCanvas = SmartDetector.findSignatureCanvas();
                if (signCanvas) {
                    await AutoSignHandler.autoSign();
                    await Utils.delay(2000);
                }

                const currentUrl = window.location.href;
                const videoId = currentUrl.split('/').pop() || 'unknown';
                const currentPage = SmartDetector.getCurrentPage();
                Utils.markVideoCompleted(videoId, currentPage);
                Logger.notify(`已完成: ${videoId}`);

                await Utils.delay(2000);

                const backBtn = document.querySelector('button:contains("返回")') ||
                               document.querySelector('[onclick*="back"]') ||
                               document.querySelector('.crec-btn');
                if (backBtn) {
                    backBtn.click();
                    this.lastActionTime = Date.now();
                }
            }
        },

        async handleVideoListPage() {
            const currentPage = SmartDetector.getCurrentPage();
            const totalPages = SmartDetector.getTotalPages();

            Utils.setCurrentPage(currentPage);
            Utils.setTotalPages(totalPages);

            const unlearnedCards = SmartDetector.findAllUnlearnedCards();

            const filteredCards = unlearnedCards.filter(card => {
                const videoId = SmartDetector.getVideoId(card);
                return !Utils.isVideoCompleted(videoId, currentPage);
            });

            if (filteredCards.length > 0) {
                const card = filteredCards[0];
                card.click();
                this.lastActionTime = Date.now();
                const videoId = SmartDetector.getVideoId(card);
                Logger.notify(`正在学习第${currentPage}页: ${videoId || '视频'}`);
                await Utils.delay(2000);
            } else {
                if (currentPage < totalPages) {
                    const nextBtn = SmartDetector.getNextPageButton();
                    if (nextBtn) {
                        nextBtn.click();
                        this.lastActionTime = Date.now();
                        Logger.notify(`第${currentPage}页已完成，前往第${currentPage + 1}页`);
                        await Utils.delay(3000);
                    }
                } else {
                    Logger.notify('🎉 所有视频已学习完成！');
                }
            }
        }
    };

    const ControlPanel = {
        panelElement: null,

        create() {
            const panel = document.createElement('div');
            panel.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;border-radius:12px;padding:15px;box-shadow:0 4px 15px rgba(0,0,0,0.3);min-width:220px;';

            this.panelElement = panel;
            this.update();
            document.body.appendChild(panel);

            setInterval(() => this.update(), 1000);
        },

        update() {
            if (!this.panelElement) return;

            const currentUser = Utils.getCurrentUser();
            const sigs = Utils.getSignatures();
            const allSigs = Utils.getAllSignatures();
            const userList = Object.keys(allSigs);
            const speed = Utils.getSpeed();
            const videoState = VideoController.getVideoState();

            let videoStatus = '未检测到视频';
            let progressBar = '';

            if (videoState) {
                const isPlaying = !videoState.paused && !videoState.ended;
                videoStatus = isPlaying ? '▶️ 播放中' : (videoState.ended ? '✅ 已结束' : '⏸️ 已暂停');

                if (videoState.duration > 0) {
                    const progress = (videoState.currentTime / videoState.duration) * 100;
                    const currentMin = Math.floor(videoState.currentTime / 60);
                    const currentSec = Math.floor(videoState.currentTime % 60);
                    const totalMin = Math.floor(videoState.duration / 60);
                    const totalSec = Math.floor(videoState.duration % 60);

                    progressBar = `
                        <div style="margin-top:5px;">
                            <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px;">
                                <span>${currentMin}:${currentSec.toString().padStart(2, '0')}</span>
                                <span>${totalMin}:${totalSec.toString().padStart(2, '0')}</span>
                            </div>
                            <div id="progress-track" style="width:100%;height:8px;background:rgba(255,255,255,0.3);border-radius:4px;overflow:hidden;cursor:pointer;position:relative;">
                                <div id="progress-fill" style="width:${progress}%;height:100%;background:#4ade80;border-radius:4px;transition:width 0.1s;"></div>
                                <div id="progress-thumb" style="position:absolute;top:50%;width:12px;height:12px;background:white;border-radius:50%;transform:translate(-50%,-50%);left:${progress}%;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
                            </div>
                        </div>
                    `;
                }
            }

            const progress = Utils.getProgress();
            const completedCount = Utils.getCompletedCount();
            const currentPage = SmartDetector.getCurrentPage();
            const totalPages = SmartDetector.getTotalPages();

            // 用户选择下拉框
            let userSelector = '';
            if (userList.length > 1) {
                userSelector = `
                    <div style="background:rgba(255,255,255,0.2);padding:6px;border-radius:6px;margin-bottom:8px;">
                        <div style="font-size:10px;margin-bottom:4px;">👥 选择签名用户</div>
                        <select id="user-select" style="width:100%;padding:4px;border-radius:4px;border:0;font-size:11px;">
                            ${userList.map(user => `
                                <option value="${user}" ${user === currentUser ? 'selected' : ''}>
                                    ${user} (${allSigs[user].length || 0}/3)
                                </option>
                            `).join('')}
                        </select>
                    </div>
                `;
            }

            this.panelElement.innerHTML = `
                <div style="font-weight:bold;margin-bottom:10px;">🎓 安全刷课 v5.20</div>
                <div style="background:rgba(74,222,128,0.3);padding:8px;border-radius:6px;margin-bottom:10px;">
                    <div style="font-size:12px;font-weight:bold;">📍 当前步骤</div>
                    <div style="font-size:11px;margin-top:4px;">${currentStepText}</div>
                    ${nextStepText ? `<div style="font-size:10px;margin-top:4px;opacity:0.8;">➡️ 下一步: ${nextStepText}</div>` : ''}
                </div>
                <div style="background:rgba(255,255,255,0.2);padding:8px;border-radius:6px;margin-bottom:10px;">
                    <div style="font-size:12px;margin-bottom:4px;">${videoStatus}</div>
                    ${progressBar}
                </div>
                <div style="background:rgba(255,255,255,0.2);padding:8px;border-radius:6px;margin-bottom:10px;">
                    <div style="font-size:12px;margin-bottom:4px;">📚 学习进度</div>
                    <div style="display:flex;justify-content:space-between;font-size:11px;">
                        <span>页码: ${currentPage}/${totalPages}</span>
                        <span>完成: ${completedCount}个</span>
                    </div>
                </div>
                <div style="background:rgba(255,255,255,0.2);padding:8px;border-radius:6px;margin-bottom:10px;">
                    <div style="font-size:11px;">👤 当前用户: <strong>${currentUser}</strong></div>
                    ${userList.length > 1 ? '<button id="reset-user-btn" style="width:100%;padding:4px;margin-top:6px;border:0;background:rgba(255,255,255,0.2);color:white;border-radius:4px;font-size:10px;">🔄 自动检测用户</button>' : ''}
                </div>
                ${userSelector}
                <div style="background:rgba(255,255,255,0.2);padding:8px;border-radius:6px;margin-bottom:10px;">
                    <div>签名: ${sigs.length}/3</div>
                    <div style="display:flex;gap:3px;margin-top:4px;">
                        ${[0,1,2].map(i => `<div style="flex:1;height:6px;background:${i < sigs.length ? '#4ade80' : 'rgba(255,255,255,0.3)'};border-radius:3px;"></div>`).join('')}
                    </div>
                </div>
                <div style="background:rgba(255,255,255,0.2);padding:6px;border-radius:6px;margin-bottom:10px;font-size:10px;opacity:0.7;">
                    🔍 ${debugInfo}
                </div>
                <div style="font-size:11px;margin-bottom:8px;opacity:0.8;">⏩ ${speed}x</div>
                <button id="record-btn" style="width:100%;padding:8px;border:0;border-radius:6px;background:rgba(255,255,255,0.9);color:#667eea;margin-bottom:5px;">
                    ${sigs.length > 0 ? '🖊 重录签名' : '🖊 录制签名'}
                </button>
                <button id="clear-progress-btn" style="width:100%;padding:6px;border:0;background:rgba(255,255,255,0.2);color:white;border-radius:4px;font-size:11px;margin-bottom:5px;">📋 清除进度</button>
                ${sigs.length > 0 ? `<button id="clear-btn" style="width:100%;padding:6px;border:0;background:rgba(255,255,255,0.2);color:white;border-radius:4px;font-size:11px;margin-bottom:5px;">🗑️ 清除当前用户签名</button>` : ''}
                ${userList.length > 1 ? `<button id="clear-all-btn" style="width:100%;padding:6px;border:0;background:rgba(239,68,68,0.3);color:white;border-radius:4px;font-size:11px;">🗑️ 清除所有签名</button>` : ''}
                <button id="speed-down" style="width:48%;padding:6px;margin-top:8px;border:0;background:rgba(255,255,255,0.3);color:white;border-radius:4px;">-</button>
                <button id="speed-up" style="width:48%;padding:6px;margin-top:8px;float:right;border:0;background:rgba(255,255,255,0.3);color:white;border-radius:4px;">+</button>
            `;

            this.panelElement.querySelector('#record-btn').onclick = () => AutoSignHandler.recordSignature();

            this.panelElement.querySelector('#clear-btn')?.addEventListener('click', () => {
                if (confirm(`确定要清除用户 "${Utils.getCurrentUser()}" 的签名吗？`)) {
                    Utils.clearSignatures();
                    Logger.notify('签名已清除');
                    this.update();
                }
            });

            this.panelElement.querySelector('#clear-all-btn')?.addEventListener('click', () => {
                if (confirm('确定要清除所有用户的签名吗？此操作不可恢复！')) {
                    Utils.clearAllSignatures();
                    Logger.notify('所有签名已清除');
                    this.update();
                }
            });

            this.panelElement.querySelector('#reset-user-btn')?.addEventListener('click', () => {
                try {
                    GM_deleteValue('selected_user');
                    Logger.notify('已重置为自动检测用户');
                    this.update();
                } catch (error) {
                    Logger.log('重置用户选择失败:', error);
                }
            });

            this.panelElement.querySelector('#user-select')?.addEventListener('change', (e) => {
                const selectedUser = e.target.value;
                // 临时覆盖用户检测，使用用户选择的签名
                // 这里我们可以使用一个临时存储来记住用户选择
                try {
                    GM_setValue('selected_user', selectedUser);
                    Logger.notify(`已选择用户: ${selectedUser}`);
                    // 临时覆盖 getCurrentUser 函数
                    const originalGetUser = Utils.getCurrentUser;
                    Utils.getCurrentUser = () => {
                        return GM_getValue('selected_user', originalGetUser.call(Utils));
                    };
                    this.update();
                } catch (error) {
                    Logger.log('选择用户失败:', error);
                }
            });

            this.panelElement.querySelector('#clear-progress-btn').addEventListener('click', () => {
                if (confirm('确定要清除所有学习进度吗？')) {
                    Utils.clearProgress();
                    Logger.notify('学习进度已清除');
                    this.update();
                }
            });

            this.panelElement.querySelector('#speed-down').onclick = () => {
                const newSpeed = Math.max(0.5, Utils.getSpeed() - 0.25);
                Utils.setSpeed(newSpeed);
                this.update();
            };

            this.panelElement.querySelector('#speed-up').onclick = () => {
                const newSpeed = Math.min(3.0, Utils.getSpeed() + 0.25);
                Utils.setSpeed(newSpeed);
                this.update();
            };

            this.setupProgressBar();
        },

        setupProgressBar() {
            const progressTrack = this.panelElement.querySelector('#progress-track');
            if (!progressTrack) return;

            let isDragging = false;

            const updateProgress = (e) => {
                if (!isDragging && e.type !== 'click') return;

                const video = SmartDetector.findVideoElement();
                if (!video || video.duration <= 0) return;

                const rect = progressTrack.getBoundingClientRect();
                let x = e.clientX || e.touches?.[0]?.clientX || 0;
                let percent = (x - rect.left) / rect.width;
                percent = Math.max(0, Math.min(1, percent));

                video.currentTime = percent * video.duration;
                this.update();
            };

            progressTrack.addEventListener('mousedown', (e) => {
                isDragging = true;
                updateProgress(e);
            });

            progressTrack.addEventListener('mousemove', updateProgress);

            progressTrack.addEventListener('mouseup', () => {
                isDragging = false;
            });

            progressTrack.addEventListener('mouseleave', () => {
                isDragging = false;
            });

            progressTrack.addEventListener('touchstart', (e) => {
                isDragging = true;
                updateProgress(e);
            });

            progressTrack.addEventListener('touchmove', updateProgress);

            progressTrack.addEventListener('touchend', () => {
                isDragging = false;
            });
        }
    };

    const Main = {
        lastNavigationTime: 0,
        navigationState: 0,

        async init() {
            Logger.notify('安全刷课 v5.18 已启动！');
            Logger.setStep('初始化完成', '检测当前页面...');
            ControlPanel.create();

            if (Utils.getSignatures().length === 0) {
                Logger.setStep('需要先录制签名', '请点击"录制签名"按钮');
                await Utils.delay(2000);
                AutoSignHandler.recordSignature();
            }

            // 立即更新一次控制面板
            ControlPanel.update();

            this.loop();
        },

        async loop() {
            while (true) {
                try {
                    ControlPanel.update();

                    // 优先处理签名弹窗（签名弹窗必须优先处理，否则会混淆）
                    const signCanvas = SmartDetector.findSignatureCanvas();
                    if (signCanvas) {
                        Logger.setStep('检测到签名弹窗', '自动签名中...');
                        await AutoSignHandler.autoSign();
                        await Utils.delay(1000);
                        continue;
                    }

                    // 然后处理挂机验证弹窗
                    const verifyBtn = SmartDetector.findVerificationButton();
                    if (verifyBtn) {
                        Logger.setStep('处理挂机验证弹窗', '点击确认按钮');
                        Utils.clickElement(verifyBtn);
                        await Utils.delay(3000);
                        continue;
                    }

                    // 处理自动导航
                    await this.handleNavigation();

                    await LessonController.process();
                } catch (e) {
                    Logger.log('循环错误:', e);
                    Logger.setStep('出现错误', e.message);
                }

                await Utils.delay(2000);
            }
        },

        async findElementByText(text, selectors) {
            // 首先尝试直接通过选择器查找
            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    const elText = el.textContent?.trim();
                    if (elText && (elText === text || elText.includes(text))) {
                        Logger.log(`直接找到: ${selector} -> "${elText}"`);
                        return el;
                    }
                }
            }

            // 如果没找到，尝试遍历所有元素
            const allElements = Array.from(document.querySelectorAll('*'));
            for (const el of allElements) {
                const tagName = el.tagName?.toLowerCase();
                if (['html', 'body', 'script', 'style', 'head', 'title'].includes(tagName)) {
                    continue;
                }

                // 检查元素是否有菜单相关的类名
                const className = el.className?.toString() || '';
                if (!className.includes('menu') && !className.includes('nav') && !className.includes('item')) {
                    continue;
                }

                const elText = el.textContent?.trim();
                if (elText && (elText === text || elText.includes(text))) {
                    Logger.log(`通过遍历找到: ${tagName}.${className} -> "${elText}"`);
                    return el;
                }
            }

            // 最后尝试查找所有包含该文本的元素，返回最小的一个（文本最短的）
            let smallestElement = null;
            let smallestTextLength = Infinity;
            for (const el of allElements) {
                const tagName = el.tagName?.toLowerCase();
                if (['html', 'body', 'script', 'style', 'head', 'title'].includes(tagName)) {
                    continue;
                }

                const elText = el.textContent?.trim();
                if (elText && elText.includes(text)) {
                    if (elText.length < smallestTextLength) {
                        smallestTextLength = elText.length;
                        smallestElement = el;
                    }
                }
            }

            if (smallestElement) {
                Logger.log(`返回最小元素: ${smallestElement.tagName} -> "${smallestElement.textContent?.trim()}"`);
            }
            return smallestElement;
        },

        async handleNavigation() {
            const now = Date.now();
            if (now - this.lastNavigationTime < 2000) return;

            // 检测菜单是否存在
            const hasCrecMenu = !!document.querySelector('.crec-menu');
            Logger.setDebug(`菜单检测: crec-menu=${hasCrecMenu} navState=${this.navigationState}`);

            if (SmartDetector.isHomePage()) {
                Logger.setStep('在首页，准备导航', '查找"事故管理"菜单');

                if (this.navigationState === 0) {
                    // 第一步：找到并点击"事故管理"菜单项
                    const accidentMenu = await this.findElementByText('事故管理', [
                        'div.crec-menu-submenu-title', 'li.crec-menu-submenu', 'div'
                    ]);
                    if (accidentMenu) {
                        Logger.setStep('找到"事故管理"菜单', '点击展开菜单');
                        Logger.log(`点击事故菜单: ${accidentMenu.tagName} ${accidentMenu.className}`);
                        Utils.clickElement(accidentMenu);
                        this.lastNavigationTime = now;
                        this.navigationState = 1;
                        await Utils.delay(1500);
                        return;
                    }
                } else if (this.navigationState === 1) {
                    // 第二步：找到并点击"案例学习"子菜单
                    Logger.setStep('查找"案例学习"子菜单', '等待菜单展开...');

                    // 先等待更长时间让菜单展开
                    await Utils.delay(1000);

                    // 查找所有包含案例学习的元素，记录调试信息
                    const allElements = Array.from(document.querySelectorAll('*'));
                    const caseStudyElements = [];
                    for (const el of allElements) {
                        const text = el.textContent?.trim();
                        if (text && text.includes('案例学习')) {
                            caseStudyElements.push({
                                tag: el.tagName,
                                cls: el.className,
                                text: text
                            });
                        }
                    }
                    Logger.log(`找到 ${caseStudyElements.length} 个包含"案例学习"的元素:`);
                    for (const el of caseStudyElements) {
                        Logger.log(`  - ${el.tag} ${el.cls}: "${el.text}"`);
                    }

                    // 尝试多种选择器查找
                    const caseStudySubmenu = await this.findElementByText('案例学习', [
                        'div.crec-menu-submenu-title', 'li.crec-menu-submenu',
                        'li', 'div', 'a', 'span'
                    ]);
                    if (caseStudySubmenu) {
                        Logger.setStep('找到"案例学习"子菜单', '点击展开');
                        Logger.log(`点击案例子菜单: ${caseStudySubmenu.tagName} ${caseStudySubmenu.className}`);
                        Utils.clickElement(caseStudySubmenu);
                        this.lastNavigationTime = now;
                        this.navigationState = 2;
                        await Utils.delay(2000);
                        return;
                    } else {
                        // 如果没找到，重新点击上一级
                        Logger.setStep('未找到子菜单', '重试点击事故管理');
                        const accidentMenu = await this.findElementByText('事故管理', [
                            'div.crec-menu-submenu-title', 'li.crec-menu-submenu'
                        ]);
                        if (accidentMenu) {
                            Logger.log('重新点击事故管理以展开菜单');
                            Utils.clickElement(accidentMenu);
                        }
                        await Utils.delay(1500);
                    }
                } else if (this.navigationState === 2) {
                    // 第三步：找到并点击最终的"案例学习"菜单项
                    Logger.setStep('查找最终"案例学习"菜单项', '等待菜单展开...');
                    const caseStudyItem = await this.findElementByText('案例学习', [
                        'li.crec-menu-item', 'div.crec-menu-item', 'a', 'div'
                    ]);
                    if (caseStudyItem) {
                        Logger.setStep('找到最终"案例学习"菜单', '点击进入');
                        Logger.log(`点击最终案例菜单: ${caseStudyItem.tagName} ${caseStudyItem.className}`);
                        Utils.clickElement(caseStudyItem);
                        this.lastNavigationTime = now;
                        this.navigationState = 3;
                        await Utils.delay(2000);
                        return;
                    } else {
                        // 如果没找到，重新点击上一级
                        Logger.setStep('未找到最终菜单', '重试点击案例子菜单');
                        const caseStudySubmenu = await this.findElementByText('案例学习', [
                            'div.crec-menu-submenu-title', 'li.crec-menu-submenu'
                        ]);
                        if (caseStudySubmenu) {
                            Utils.clickElement(caseStudySubmenu);
                        }
                        await Utils.delay(1000);
                    }
                }
            } else {
                // 不在首页，重置导航状态
                if (this.navigationState !== 0) {
                    this.navigationState = 0;
                }
                Logger.setStep('在学习页面', '继续学习流程');
            }
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => Main.init());
    } else {
        Main.init();
    }
})();

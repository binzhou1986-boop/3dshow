(function () {
    'use strict';

    const DEMOS_JSON = 'demos.json';

    const grid = document.getElementById('gallery-grid');
    const modal = document.getElementById('preview-modal');
    const previewIframe = document.getElementById('preview-iframe');
    const previewTitle = document.getElementById('preview-title');
    const btnBack = document.getElementById('btn-back');
    const btnFullscreen = document.getElementById('btn-fullscreen');

    // 加载配置
    fetch(DEMOS_JSON)
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
            return r.json();
        })
        .then(demos => {
            if (!demos.length) {
                grid.innerHTML = '<div class="empty-state"><p>暂无演示项目</p></div>';
                return;
            }
            grid.innerHTML = '';
            demos.forEach((demo, index) => {
                grid.appendChild(createCard(demo, index));
            });
        })
        .catch(err => {
            console.error('加载 demos.json 失败:', err);
            grid.innerHTML = `
                <div class="empty-state">
                    <p>加载失败</p>
                    <p class="hint">请通过本地服务器访问此页面，不要直接双击打开文件</p>
                    <p class="hint">访问地址: http://localhost:8901</p>
                </div>
            `;
        });

    function createCard(demo, index) {
        const card = document.createElement('div');
        card.className = 'card';

        // 预览 iframe
        const preview = document.createElement('div');
        preview.className = 'card-preview';

        const iframe = document.createElement('iframe');
        iframe.loading = 'lazy';

        // iframe 加载后注入隐藏 UI 的样式（必须在设置 src 之前绑定）
        iframe.addEventListener('load', () => {
            try {
                const style = iframe.contentDocument.createElement('style');
                style.textContent = '#ui-overlay { display: none !important; }';
                iframe.contentDocument.head.appendChild(style);
            } catch (e) {
                // 跨域限制时忽略
            }
        });

        iframe.src = `demos/${demo.id}/`;
        preview.appendChild(iframe);

        // 悬浮播放遮罩
        const overlay = document.createElement('div');
        overlay.className = 'card-overlay';
        overlay.innerHTML = '<div class="play-icon">▶</div>';
        preview.appendChild(overlay);

        card.appendChild(preview);

        // 信息
        const info = document.createElement('div');
        info.className = 'card-info';
        info.innerHTML = `
            <h3>${demo.name}</h3>
            <div class="desc">${demo.description}</div>
            <div class="card-tags">
                ${(demo.tags || []).map(t => `<span>${t}</span>`).join('')}
            </div>
        `;
        card.appendChild(info);

        // 点击打开
        card.addEventListener('click', () => openDemo(demo, false));

        return card;
    }

    function openDemo(demo, hideUI) {
        previewTitle.textContent = demo.name;

        if (hideUI) {
            previewIframe.addEventListener('load', function handler() {
                try {
                    const style = previewIframe.contentDocument.createElement('style');
                    style.textContent = '#ui-overlay { display: none !important; }';
                    previewIframe.contentDocument.head.appendChild(style);
                } catch (e) {}
                previewIframe.removeEventListener('load', handler);
            });
        }

        previewIframe.src = `demos/${demo.id}/`;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeDemo() {
        modal.classList.remove('active');
        previewIframe.src = '';
        document.body.style.overflow = '';
        // 退出全屏
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
    }

    btnBack.addEventListener('click', closeDemo);

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeDemo();
        }
    });

    // 全屏
    btnFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            modal.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    });
})();

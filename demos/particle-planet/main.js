/**
 * 粒子星球 — 绚丽增强版
 *
 * 增强：
 * - 多色彩粒子：橙、红、金、紫、蓝等天体色彩
 * - 手势旋转：手部旋转角度驱动星球旋转
 * - 手势缩放：握拳远离 / 5指张开靠近（先快后慢）
 */

(function () {
    'use strict';

    const CONFIG = {
        planet: {
            radius: 5,
            particleCount: 10000,
            surfaceParticleCount: 5000,
            // 多种天体色彩分布
            colorPalette: [
                [1.00, 0.55, 0.10],  // 亮橙
                [1.00, 0.30, 0.05],  // 深橙红
                [1.00, 0.70, 0.20],  // 金黄
                [0.90, 0.20, 0.15],  // 红
                [0.80, 0.15, 0.50],  // 紫红
                [0.30, 0.20, 0.90],  // 深蓝紫
                [1.00, 0.85, 0.30],  // 暖金
                [0.95, 0.50, 0.20],  // 琥珀
            ],
            surfacePalette: [
                [1.00, 0.80, 0.25],  // 亮金
                [1.00, 0.60, 0.15],  // 橙金
                [1.00, 0.95, 0.50],  // 亮黄
                [1.00, 0.40, 0.10],  // 红橙
                [0.85, 0.25, 0.60],  // 紫
                [0.50, 0.30, 0.95],  // 蓝紫
            ],
        },
        rings: [
            {
                innerRadius: 7.5, outerRadius: 10.0,
                particleCount: 5000, tilt: 0.15,
                palette: [[0.95, 0.90, 1.0], [0.80, 0.85, 1.0], [1.0, 0.95, 0.95], [0.70, 0.80, 1.0]],
            },
        ],
        camera: {
            initialDistance: 25,
            minDistance: 8,
            maxDistance: 55,
            fov: 60,
        },
        particleSize: {
            planet: 0.28,
            surface: 0.35,
            ring: 0.16,
        },
        animation: {
            autoRotateSpeed: 0.002,
        },
    };

    let scene, camera, renderer;
    let planetGroup;
    let zoomTarget = 0;
    let rollAmount = 0;         // 当前滚动旋转量（缩放时的额外旋转）
    let rollVelocity = 0;       // 滚动速度（衰减用）
    let targetRotationY = 0;
    let targetRotationX = 0;
    let lastHandRotationZ = 0;
    let lastGestureType = 'normal';

    // 摄像头预览画布
    let previewCanvas, previewCtx;
    let camReady = false;

    const planetVertexShader = `
        attribute float aSize;
        attribute vec3 aColor;
        varying vec3 vColor;
        varying float vDist;
        uniform float uTime;
        uniform float uPixelRatio;

        void main() {
            vColor = aColor;
            vec3 pos = position;
            float pulse = sin(uTime * 1.8 + length(pos) * 0.9) * 0.06;
            pos = pos * (1.0 + pulse);
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            vDist = -mvPosition.z;
            gl_PointSize = aSize * uPixelRatio * 140.0 / -mvPosition.z;
            gl_Position = projectionMatrix * mvPosition;
        }
    `;

    const planetFragmentShader = `
        varying vec3 vColor;
        varying float vDist;

        void main() {
            vec2 center = gl_PointCoord - 0.5;
            float d = length(center);
            if (d > 0.5) discard;
            float glow = exp(-d * 3.5);
            float alpha = glow * 0.95;
            float distFade = clamp(1.0 - vDist / 70.0, 0.15, 1.0);
            vec3 col = vColor * (1.0 + glow * 0.6);
            gl_FragColor = vec4(col * distFade * 1.6, alpha * 0.92);
        }
    `;

    const ringVertexShader = `
        attribute float aSize;
        attribute vec3 aColor;
        varying vec3 vColor;
        uniform float uTime;
        uniform float uPixelRatio;

        void main() {
            vColor = aColor;
            vec3 pos = position;
            pos.y += sin(uTime * 2.0 + length(pos.xz) * 0.6) * 0.1;
            pos.xz *= 1.0 + sin(uTime * 0.8 + pos.y * 2.0) * 0.02;
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = aSize * uPixelRatio * 110.0 / -mvPosition.z;
            gl_Position = projectionMatrix * mvPosition;
        }
    `;

    const ringFragmentShader = `
        varying vec3 vColor;
        uniform float uTime;

        void main() {
            vec2 center = gl_PointCoord - 0.5;
            float d = length(center);
            if (d > 0.5) discard;
            float twinkle = 0.6 + 0.4 * sin(uTime * 3.5 + gl_FragCoord.x * 0.15 + gl_FragCoord.y * 0.1);
            float alpha = (1.0 - smoothstep(0.1, 0.5, d)) * twinkle * 0.85;
            gl_FragColor = vec4(vColor * 1.3, alpha);
        }
    `;

    function makePlanetMaterial() {
        return new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: renderer.getPixelRatio() },
            },
            vertexShader: planetVertexShader,
            fragmentShader: planetFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
    }

    function makeRingMaterial() {
        return new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: renderer.getPixelRatio() },
            },
            vertexShader: ringVertexShader,
            fragmentShader: ringFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
    }

    function pickColor(palette) {
        return palette[Math.floor(Math.random() * palette.length)].slice();
    }

    function createPlanet() {
        planetGroup = new THREE.Group();
        const cfg = CONFIG.planet;

        // --- 内部粒子（多色彩） ---
        const count = cfg.particleCount;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const r = cfg.radius * Math.pow(Math.random(), 0.5);
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);

            const c = pickColor(cfg.colorPalette);
            // 根据半径调整颜色：中心更偏红/紫，外层更偏橙/金
            const radialBlend = r / cfg.radius;
            const innerColor = [0.9, 0.2, 0.4];  // 中心偏紫红
            colors[i * 3]     = Math.min(1, c[0] * (1 - radialBlend * 0.3) + innerColor[0] * radialBlend * 0.3);
            colors[i * 3 + 1] = Math.min(1, c[1] * (1 - radialBlend * 0.2) + innerColor[1] * radialBlend * 0.2);
            colors[i * 3 + 2] = Math.min(1, c[2] * (1 - radialBlend * 0.4) + innerColor[2] * radialBlend * 0.4);

            sizes[i] = CONFIG.particleSize.planet * (0.5 + Math.random() * 0.9);
        }

        const innerGeom = new THREE.BufferGeometry();
        innerGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        innerGeom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        innerGeom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        planetGroup.add(new THREE.Points(innerGeom, makePlanetMaterial()));

        // --- 表面聚集粒子 ---
        const sc = cfg.surfaceParticleCount;
        const sp = new Float32Array(sc * 3);
        const sc2 = new Float32Array(sc * 3);
        const ss = new Float32Array(sc);

        for (let i = 0; i < sc; i++) {
            const r = cfg.radius * (0.90 + Math.random() * 0.20);
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            sp[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            sp[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            sp[i * 3 + 2] = r * Math.cos(phi);

            const c = pickColor(cfg.surfacePalette);
            sc2[i * 3]     = Math.min(1, c[0] + (Math.random() - 0.5) * 0.12);
            sc2[i * 3 + 1] = Math.min(1, c[1] + (Math.random() - 0.5) * 0.15);
            sc2[i * 3 + 2] = Math.min(1, c[2] + (Math.random() - 0.5) * 0.15);

            ss[i] = CONFIG.particleSize.surface * (0.4 + Math.random() * 0.9);
        }

        const surfGeom = new THREE.BufferGeometry();
        surfGeom.setAttribute('position', new THREE.BufferAttribute(sp, 3));
        surfGeom.setAttribute('aColor', new THREE.BufferAttribute(sc2, 3));
        surfGeom.setAttribute('aSize', new THREE.BufferAttribute(ss, 1));
        planetGroup.add(new THREE.Points(surfGeom, makePlanetMaterial()));

        // --- 发光 sprite ---
        const glowTex = createGlowTexture();
        const glowSprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
                map: glowTex, blending: THREE.AdditiveBlending,
                transparent: true, opacity: 0.55, depthWrite: false,
            })
        );
        glowSprite.scale.set(cfg.radius * 5.5, cfg.radius * 5.5, 1);
        planetGroup.add(glowSprite);

        // --- 第二层更大的光晕 ---
        const glow2Tex = createOuterGlowTexture();
        const glow2Sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
                map: glow2Tex, blending: THREE.AdditiveBlending,
                transparent: true, opacity: 0.35, depthWrite: false,
            })
        );
        glow2Sprite.scale.set(cfg.radius * 9, cfg.radius * 9, 1);
        planetGroup.add(glow2Sprite);

        scene.add(planetGroup);
    }

    function createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
        grad.addColorStop(0, 'rgba(255, 200, 60, 1.0)');
        grad.addColorStop(0.15, 'rgba(255, 140, 20, 0.8)');
        grad.addColorStop(0.35, 'rgba(255, 80, 10, 0.5)');
        grad.addColorStop(0.6, 'rgba(200, 50, 60, 0.2)');
        grad.addColorStop(0.8, 'rgba(100, 30, 120, 0.08)');
        grad.addColorStop(1, 'rgba(50, 20, 80, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 512);
        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }

    function createOuterGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
        grad.addColorStop(0, 'rgba(255, 150, 40, 0.4)');
        grad.addColorStop(0.3, 'rgba(255, 100, 20, 0.15)');
        grad.addColorStop(0.6, 'rgba(180, 60, 80, 0.05)');
        grad.addColorStop(1, 'rgba(50, 20, 60, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 512);
        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }

    function createRings() {
        if (!planetGroup) return;

        CONFIG.rings.forEach((ringCfg, idx) => {
            const count = ringCfg.particleCount;
            const pos = new Float32Array(count * 3);
            const col = new Float32Array(count * 3);
            const sz = new Float32Array(count);

            for (let i = 0; i < count; i++) {
                const angle = Math.random() * Math.PI * 2;
                const r = ringCfg.innerRadius + Math.random() * (ringCfg.outerRadius - ringCfg.innerRadius);
                const h = (Math.random() - 0.5) * 0.8;

                pos[i * 3]     = r * Math.cos(angle);
                pos[i * 3 + 1] = h;
                pos[i * 3 + 2] = r * Math.sin(angle);

                const c = pickColor(ringCfg.palette);
                col[i * 3]     = Math.min(1, c[0] + (Math.random() - 0.5) * 0.15);
                col[i * 3 + 1] = Math.min(1, c[1] + (Math.random() - 0.5) * 0.15);
                col[i * 3 + 2] = Math.min(1, c[2] + (Math.random() - 0.5) * 0.12);

                sz[i] = CONFIG.particleSize.ring * (0.4 + Math.random() * 1.1);
            }

            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geom.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
            geom.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));

            const points = new THREE.Points(geom, makeRingMaterial());
            points.rotation.x = ringCfg.tilt;
            points.rotation.z = idx * 0.35;
            planetGroup.add(points);
        });
    }

    function createBackgroundStars() {
        const count = 4000;
        const pos = new Float32Array(count * 3);
        const col = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const r = 80 + Math.random() * 200;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            pos[i * 3 + 2] = r * Math.cos(phi);

            // 背景星也有色彩变化
            const starType = Math.random();
            if (starType < 0.6) {
                col[i * 3] = 1; col[i * 3 + 1] = 1; col[i * 3 + 2] = 1;      // 白
            } else if (starType < 0.75) {
                col[i * 3] = 0.8; col[i * 3 + 1] = 0.85; col[i * 3 + 2] = 1; // 蓝白
            } else if (starType < 0.88) {
                col[i * 3] = 1; col[i * 3 + 1] = 0.9; col[i * 3 + 2] = 0.7; // 暖黄
            } else {
                col[i * 3] = 1; col[i * 3 + 1] = 0.7; col[i * 3 + 2] = 0.6; // 红
            }
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geom.setAttribute('color', new THREE.BufferAttribute(col, 3));

        scene.add(new THREE.Points(geom, new THREE.PointsMaterial({
            size: 0.25, color: 0xffffff, transparent: true, opacity: 0.55,
            sizeAttenuation: true, depthWrite: false, vertexColors: true,
        })));
    }

    function onHandResults(results) {
        const state = GestureState;
        if (!state.handDetected) {
            zoomTarget = 0;
            updateCameraStatus(false);
            return;
        }
        updateCameraStatus(true);

        // --- 旋转：手部旋转驱动星球旋转（更灵敏） ---
        if (state.handDetected) {
            const deltaRot = state.handRotationZ - lastHandRotationZ;
            targetRotationY -= deltaRot * 4.0;
        }
        lastHandRotationZ = state.handRotationZ;

        // --- 缩放时的滚动效果 ---
        if (state.gestureType !== lastGestureType && state.gestureType !== 'normal') {
            if (state.gestureType === 'open') {
                rollVelocity += 0.35;   // 靠近：正转加速（像滚过来）
            } else if (state.gestureType === 'fist') {
                rollVelocity -= 0.25;   // 远离：反转加速（像滚走）
            }
        }
        lastGestureType = state.gestureType;

        // --- 缩放目标设置（在 animate 中执行，保证 60fps 平滑） ---
        if (state.gestureType === 'fist') {
            zoomTarget = 1;   // 握拳 → 远离
        } else if (state.gestureType === 'open') {
            zoomTarget = -1;  // 张开 → 靠近
        } else {
            zoomTarget = 0;   // 无手势 → 停止缩放
        }

        updateGestureStatus(state);
    }

    function updateGestureStatus(state) {
        const el = document.getElementById('gesture-label');
        if (!el) return;
        const labels = { open: '靠近', fist: '远离', normal: '旋转' };
        el.textContent = labels[state.gestureType] || '未识别';
    }

    function updateCameraStatus(ready) {
        camReady = ready;
        const el = document.getElementById('cam-state');
        if (el) {
            el.className = ready ? 'on' : 'off';
            el.textContent = ready ? '已连接' : '未连接';
        }
    }

    function drawPreview(results) {
        if (!previewCtx || !results || !results.image) return;
        const canvas = previewCanvas;
        const ctx = previewCtx;
        const img = results.image;
        const w = canvas.width, h = canvas.height;

        updateCameraStatus(true);
        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(img, -w, 0, w, h);
        ctx.restore();

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const lm = results.multiHandLandmarks[0];
            const color = GestureState.gestureType === 'open' ? '#ff6644' :
                          GestureState.gestureType === 'fist' ? '#ff4466' : '#ffaa00';

            const connections = [
                [0,1],[1,2],[2,3],[3,4],
                [0,5],[5,6],[6,7],[7,8],
                [5,9],[9,10],[10,11],[11,12],
                [9,13],[13,14],[14,15],[15,16],
                [13,17],[17,18],[18,19],[19,20],
                [0,17],
            ];
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            connections.forEach(([a, b]) => {
                ctx.beginPath();
                ctx.moveTo(lm[a].x * w, lm[a].y * h);
                ctx.lineTo(lm[b].x * w, lm[b].y * h);
                ctx.stroke();
            });

            lm.forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#fff';
                ctx.fill();
            });
        }
    }

    function animate() {
        requestAnimationFrame(animate);
        const time = performance.now() * 0.001;

        planetGroup.children.forEach((child) => {
            if (child.material && child.material.uniforms && child.material.uniforms.uTime) {
                child.material.uniforms.uTime.value = time;
            }
        });

        // 自转
        planetGroup.rotation.y += CONFIG.animation.autoRotateSpeed;

        // 手势旋转 — 更灵敏的响应
        const rotFactor = 0.25;
        planetGroup.rotation.y += (targetRotationY - planetGroup.rotation.y) * rotFactor;
        // 滚动效果：速度积分，缓慢衰减
        rollVelocity *= 0.96;  // 每帧衰减
        if (Math.abs(rollVelocity) > 0.001) {
            planetGroup.rotation.y += rollVelocity;
        }
        planetGroup.rotation.x += (targetRotationX - planetGroup.rotation.x) * rotFactor;

        // 缩放 — 在 60fps 渲染循环中执行，保证流畅
        let currentDist = camera.position.length();
        if (zoomTarget !== 0) {
            const distRatio = (currentDist - CONFIG.camera.minDistance) /
                             (CONFIG.camera.maxDistance - CONFIG.camera.minDistance);
            const baseSpeed = 0.3;
            const slowDown = 1 - distRatio * 0.5;
            currentDist += zoomTarget * baseSpeed * slowDown;
            currentDist = Math.max(CONFIG.camera.minDistance,
                          Math.min(CONFIG.camera.maxDistance, currentDist));
        }
        // 相机位置平滑插值
        const currentDir = camera.position.clone().normalize();
        const targetPos = currentDir.multiplyScalar(currentDist);
        camera.position.lerp(targetPos, 0.12);
        camera.lookAt(0, 0, 0);

        // 发光 sprite 脉动
        if (planetGroup.children.length >= 3) {
            const glow1 = planetGroup.children[2]; // 内层光晕
            const glow2 = planetGroup.children[3]; // 外层光晕
            if (glow1.material) {
                glow1.material.opacity = 0.5 + Math.sin(time * 2) * 0.08;
                const s = 5.5 + Math.sin(time * 1.5) * 0.3;
                glow1.scale.set(CONFIG.planet.radius * s, CONFIG.planet.radius * s, 1);
            }
            if (glow2 && glow2.material) {
                glow2.material.opacity = 0.3 + Math.sin(time * 1.2 + 1) * 0.06;
            }
        }

        renderer.render(scene, camera);
    }

    function onResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    function initPreview() {
        previewCanvas = document.getElementById('preview-canvas');
        previewCtx = previewCanvas.getContext('2d');
        previewCanvas.width = 220;
        previewCanvas.height = 165;
    }

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
            document.body.classList.add('fullscreen');
        } else {
            document.exitFullscreen().catch(() => {});
            document.body.classList.remove('fullscreen');
        }
    }

    function init() {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x010008);

        camera = new THREE.PerspectiveCamera(
            CONFIG.camera.fov, window.innerWidth / window.innerHeight, 0.1, 500
        );
        camera.position.set(0, 0, CONFIG.camera.initialDistance);
        camera.lookAt(0, 0, 0);

        renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById('canvas3d'),
            antialias: true,
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        createPlanet();
        createRings();
        createBackgroundStars();
        initPreview();
        updateCameraStatus(false);

        window.addEventListener('resize', onResize);
        initHandTracking((results) => {
            drawPreview(results);
            onHandResults(results);
        });

        // 鼠标控制
        let mouseDown = false;
        let prevMouse = { x: 0, y: 0 };
        const canvas3d = document.getElementById('canvas3d');

        canvas3d.addEventListener('mousedown', (e) => {
            mouseDown = true;
            prevMouse.x = e.clientX;
            prevMouse.y = e.clientY;
        });

        window.addEventListener('mousemove', (e) => {
            if (!mouseDown) return;
            const dx = e.clientX - prevMouse.x;
            const dy = e.clientY - prevMouse.y;
            targetRotationY -= dx * 0.005;
            targetRotationX -= dy * 0.005;
            prevMouse.x = e.clientX;
            prevMouse.y = e.clientY;
        });

        window.addEventListener('mouseup', () => { mouseDown = false; });

        canvas3d.addEventListener('wheel', (e) => {
            e.preventDefault();
            const dir = camera.position.clone().normalize();
            let currentDist = camera.position.length();
            currentDist += e.deltaY * 0.05;
            currentDist = Math.max(CONFIG.camera.minDistance,
                          Math.min(CONFIG.camera.maxDistance, currentDist));
            camera.position.copy(dir.multiplyScalar(currentDist));
            zoomTarget = 0;
        }, { passive: false });

        canvas3d.addEventListener('dblclick', toggleFullscreen);

        // 全屏检测
        document.addEventListener('fullscreenchange', () => {
            document.body.classList.toggle('fullscreen', !!document.fullscreenElement);
        });

        animate();
    }

    window.addEventListener('DOMContentLoaded', init);
})();

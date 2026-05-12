/**
 * 青竹蜂云剑阵 — 凡人修仙传
 *
 * 青竹蜂云剑围绕球体飞行，手势控制：
 * - 5指张开 → 散开成飞龙，跟随食指移动
 * - 握拳 → 收敛回球形剑阵
 * - 无手 → 自动环绕飞行
 */

(function () {
    'use strict';

    const CONFIG = {
        swords: {
            count: 256,
            sphereRadius: 5.5,
        },
        dragon: {
            length: 16,       // 龙身长度
            amplitude: 2.5,   // 龙身波浪幅度
            headRadius: 2.0,  // 龙头聚集半径
        },
        camera: {
            fov: 60,
            initialDistance: 16,
            minDistance: 6,
            maxDistance: 35,
        },
        animation: {
            orbitSpeed: 0.15,
        },
        transition: {
            toDragon: 0.035,
            toSphere: 0.025,
        },
    };

    let scene, camera, renderer;
    let swordsGroup;

    // 飞剑轨道参数
    let orbitTheta;    // 轨道经度
    let orbitPhi;      // 轨道纬度偏移
    let orbitSpeed;    // 轨道速度
    let orbitRadius;   // 轨道半径
    let orbitTilt;     // 轨道倾斜角

    // 飞龙参数
    let dragonParams;  // 每把剑在龙身上的位置参数

    // 状态
    let currentPositions;
    let trailPositions;
    let targetPositions;  // 目标位置（根据状态计算）

    let dragonProgress = 0;   // 0=球阵, 1=飞龙
    let dragonProgressTarget = 0;

    let handDetected = false;
    let lastGestureType = 'normal';

    // 飞龙目标位置
    let dragonHead = { x: 0, y: 0, z: 0 };
    let dragonDirX = 0;  // 龙的方向角

    // 鼠标控制
    let mouseDown = false;
    let prevMouse = { x: 0, y: 0 };

    // 预览
    let previewCanvas, previewCtx;

    // ==================== 飞剑 Shader ====================

    const swordVertexShader = `
        attribute float aSize;
        attribute float aPhase;
        attribute vec3 aColor;
        varying vec3 vColor;
        varying float vDragonProgress;
        uniform float uTime;
        uniform float uDragonProgress;
        uniform float uPixelRatio;
        uniform vec3 uDragonHead;
        uniform float uDragonDir;

        void main() {
            vDragonProgress = uDragonProgress;
            vec3 pos = position;

            // 收敛时发光变大
            float sizeMul = 1.0 + uDragonProgress * 0.4;

            vColor = aColor;
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = aSize * uPixelRatio * sizeMul * 250.0 / -mvPosition.z;
            gl_Position = projectionMatrix * mvPosition;
        }
    `;

    // 青竹蜂云剑 Fragment Shader
    const swordFragmentShader = `
        varying vec3 vColor;
        varying float vDragonProgress;

        // 竹节纹理
        float bambooNode(float y, float freq) {
            float t = fract(y * freq);
            return smoothstep(0.45, 0.5, t) * smoothstep(0.55, 0.5, t);
        }

        void main() {
            vec2 uv = gl_PointCoord;
            float x = uv.x - 0.5;
            float y = uv.y;

            // 青竹蜂云剑：更细更长
            float bladeWidth = 0.05;
            float handleWidth = 0.03;
            float guardWidth = 0.16;
            float pommelSize = 0.035;

            // 剑尖 (y=0.90-0.97): 更尖的三角形
            if (y > 0.90) {
                float tipProgress = (y - 0.90) / 0.07;
                float w = bladeWidth * (1.0 - tipProgress * tipProgress);
                if (abs(x) > w) discard;
            }
            // 剑身 (y=0.20-0.90): 细长
            else if (y > 0.20) {
                if (abs(x) > bladeWidth) discard;
            }
            // 护手 (y=0.17-0.22): 金色护手
            else if (y > 0.17) {
                if (abs(x) > guardWidth) discard;
            }
            // 剑柄 (y=0.06-0.17)
            else if (y > 0.06) {
                if (abs(x) > handleWidth) discard;
            }
            // 剑首 (y=0.01-0.06): 小圆
            else if (y > 0.01) {
                if (length(vec2(x, y - 0.035)) > pommelSize) discard;
            }
            else {
                discard;
            }

            // 青竹绿色主色调
            vec3 greenBamboo = vec3(0.13, 0.80, 0.53);
            vec3 darkGreen = vec3(0.08, 0.55, 0.35);
            vec3 goldGuard = vec3(1.0, 0.85, 0.15);
            vec3 goldHandle = vec3(0.85, 0.70, 0.10);

            vec3 swordCol;

            if (y > 0.17 && y <= 0.22) {
                // 护手 - 金色
                swordCol = goldGuard;
            } else if (y > 0.06) {
                // 剑柄 - 深金
                swordCol = goldHandle;
            } else {
                // 剑身 - 青竹绿渐变
                float bladeT = (y - 0.20) / 0.70;
                swordCol = mix(darkGreen, greenBamboo, bladeT);

                // 竹节纹理
                float node = bambooNode(y, 8.0);
                swordCol = mix(swordCol, vec3(0.05, 0.40, 0.25), node * 0.3);
            }

            // 飞龙状态更亮
            float brightness = 1.0 + vDragonProgress * 0.6;
            swordCol *= brightness;

            // 剑尖发光
            if (y > 0.80) {
                float tipGlow = (y - 0.80) / 0.17;
                swordCol += vec3(0.1, 0.4, 0.25) * tipGlow * 0.5;
            }

            gl_FragColor = vec4(swordCol, 0.92);
        }
    `;

    // 拖尾 Shader
    const trailVertexShader = `
        attribute float aSize;
        uniform float uTime;
        uniform float uPixelRatio;
        uniform float uDragonProgress;

        void main() {
            vec3 pos = position;
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            float sizeMul = 1.0 + uDragonProgress * 0.3;
            gl_PointSize = aSize * uPixelRatio * sizeMul * 200.0 / -mvPosition.z;
            gl_Position = projectionMatrix * mvPosition;
        }
    `;

    const trailFragmentShader = `
        varying vec3 vColor;

        void main() {
            vec2 uv = gl_PointCoord;
            float x = uv.x - 0.5;
            float y = uv.y;

            // 简化的青竹蜂云剑形
            if (y > 0.90) {
                float t = (y - 0.90) / 0.07;
                if (abs(x) > 0.04 * (1.0 - t * t)) discard;
            } else if (y > 0.20) {
                if (abs(x) > 0.04) discard;
            } else if (y > 0.17) {
                if (abs(x) > 0.10) discard;
            } else if (y > 0.06) {
                if (abs(x) > 0.025) discard;
            } else if (y > 0.01) {
                if (length(vec2(x, y - 0.035)) > 0.03) discard;
            } else {
                discard;
            }

            gl_FragColor = vec4(0.1, 0.65, 0.4, 0.28);
        }
    `;

    // ==================== 轨道参数生成 ====================
    function generateOrbitParams(count, radius) {
        const goldenRatio = (1 + Math.sqrt(5)) / 2;
        const positions = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        const thetas = new Float32Array(count);
        const phis = new Float32Array(count);
        const speeds = new Float32Array(count);
        const radii = new Float32Array(count);
        const tilts = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const theta = 2 * Math.PI * i / goldenRatio;
            const phi = Math.acos(1 - 2 * (i + 0.5) / count);
            const r = radius * (0.85 + Math.random() * 0.3);

            positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);

            // 轨道参数
            thetas[i] = theta;
            phis[i] = phi + (Math.random() - 0.5) * 0.3;
            speeds[i] = CONFIG.animation.orbitSpeed * (0.8 + Math.random() * 0.4) * (r / radius);
            radii[i] = r;
            tilts[i] = (Math.random() - 0.5) * 0.5;  // 轨道倾斜

            phases[i] = Math.random() * Math.PI * 2;
        }

        return { positions, phases, thetas, phis, speeds, radii, tilts };
    }

    // ==================== 飞龙形状生成 ====================
    function generateDragonParams(count) {
        const positions = new Float32Array(count * 3);
        const alongBody = new Float32Array(count);  // 0=龙头, 1=龙尾
        const aroundBody = new Float32Array(count); // 绕龙身的角度

        const headCount = Math.floor(count * 0.25);
        const bodyCount = count - headCount;

        // 龙头：球形聚集
        for (let i = 0; i < headCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = CONFIG.dragon.headRadius * Math.pow(Math.random(), 0.5);
            positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);
            alongBody[i] = 0;
            aroundBody[i] = theta;
        }

        // 龙身：正弦波浪
        const dragonLen = CONFIG.dragon.length;
        const amp = CONFIG.dragon.amplitude;

        for (let i = headCount; i < count; i++) {
            const t = (i - headCount) / bodyCount;  // 0~1 沿龙身
            const s = t * dragonLen;  // 沿龙身距离

            // 龙头在 z=0, 龙尾在 z=dragonLen
            positions[i * 3]     = Math.sin(s * 0.8) * amp * (1.0 - t * 0.5);
            positions[i * 3 + 1] = Math.cos(s * 0.6 + 1.0) * amp * 0.6 * (1.0 - t * 0.4);
            positions[i * 3 + 2] = s;

            alongBody[i] = t;
            aroundBody[i] = t * Math.PI * 4;  // 绕龙身旋转
        }

        return { positions, alongBody, aroundBody, headCount };
    }

    // ==================== 颜色分配 ====================
    function assignColors(count) {
        const colors = new Float32Array(count * 3);
        const greenBamboo = [0.13, 0.80, 0.53];
        const darkGreen = [0.08, 0.55, 0.35];
        const goldGuard = [1.0, 0.85, 0.15];

        for (let i = 0; i < count; i++) {
            // 大部分是青竹绿色，少数是金色护手
            if (i % 12 === 0) {
                colors[i * 3] = goldGuard[0];
                colors[i * 3 + 1] = goldGuard[1];
                colors[i * 3 + 2] = goldGuard[2];
            } else {
                const t = Math.random();
                colors[i * 3]     = darkGreen[0] + (greenBamboo[0] - darkGreen[0]) * t;
                colors[i * 3 + 1] = darkGreen[1] + (greenBamboo[1] - darkGreen[1]) * t;
                colors[i * 3 + 2] = darkGreen[2] + (greenBamboo[2] - darkGreen[2]) * t;
            }
        }
        return colors;
    }

    // ==================== 初始化 ====================
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

        swordsGroup = new THREE.Group();

        // 生成轨道参数
        const orbit = generateOrbitParams(CONFIG.swords.count, CONFIG.swords.sphereRadius);
        orbitTheta = orbit.thetas;
        orbitPhi = orbit.phis;
        orbitSpeed = orbit.speeds;
        orbitRadius = orbit.radii;
        orbitTilt = orbit.tilts;
        const phases = orbit.phases;

        // 生成飞龙参数
        const dragon = generateDragonParams(CONFIG.swords.count);
        dragonParams = dragon;

        const colors = assignColors(CONFIG.swords.count);
        const sizes = new Float32Array(CONFIG.swords.count);
        for (let i = 0; i < CONFIG.swords.count; i++) {
            sizes[i] = 0.6 + Math.random() * 0.5;
        }

        // 当前位置 = 初始球阵位置
        currentPositions = new Float32Array(orbit.positions);
        trailPositions = new Float32Array(orbit.positions);
        targetPositions = new Float32Array(orbit.positions);

        // 主飞剑层
        const posAttr = new THREE.BufferAttribute(currentPositions, 3);
        const swordGeom = new THREE.BufferGeometry();
        swordGeom.setAttribute('position', posAttr);
        swordGeom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        swordGeom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        swordGeom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

        const swordMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uDragonProgress: { value: 0 },
                uPixelRatio: { value: renderer.getPixelRatio() },
                uDragonHead: { value: new THREE.Vector3(0, 0, 0) },
                uDragonDir: { value: 0 },
            },
            vertexShader: swordVertexShader,
            fragmentShader: swordFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        swordsGroup.add(new THREE.Points(swordGeom, swordMat));

        // 拖尾层
        const trailPosAttr = new THREE.BufferAttribute(trailPositions, 3);
        const trailGeom = new THREE.BufferGeometry();
        trailGeom.setAttribute('position', trailPosAttr);
        trailGeom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        const trailMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: renderer.getPixelRatio() },
                uDragonProgress: { value: 0 },
            },
            vertexShader: trailVertexShader,
            fragmentShader: trailFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        swordsGroup.add(new THREE.Points(trailGeom, trailMat));

        // 中心光晕（球阵时微弱，飞龙时明亮）
        const glowTex = createBambooGlowTexture();
        const glowSprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
                map: glowTex, blending: THREE.AdditiveBlending,
                transparent: true, opacity: 0.15, depthWrite: false,
            })
        );
        glowSprite.scale.set(3, 3, 1);
        swordsGroup.add(glowSprite);

        scene.add(swordsGroup);

        createBackgroundStars();
        initPreview();
        updateCameraStatus(false);

        window.addEventListener('resize', onResize);
        initHandTracking((results) => {
            drawPreview(results);
            onHandResults(results);
        });
        setupMouseControls();

        animate();
    }

    function createBambooGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
        grad.addColorStop(0, 'rgba(30, 200, 120, 0.8)');
        grad.addColorStop(0.2, 'rgba(20, 150, 80, 0.4)');
        grad.addColorStop(0.5, 'rgba(10, 100, 50, 0.15)');
        grad.addColorStop(1, 'rgba(0, 50, 20, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 512);
        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }

    function createBackgroundStars() {
        const count = 3000;
        const pos = new Float32Array(count * 3);
        const col = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const r = 80 + Math.random() * 200;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            pos[i * 3 + 2] = r * Math.cos(phi);

            const starType = Math.random();
            if (starType < 0.6) { col[i * 3] = 1; col[i * 3 + 1] = 1; col[i * 3 + 2] = 1; }
            else if (starType < 0.75) { col[i * 3] = 0.8; col[i * 3 + 1] = 0.85; col[i * 3 + 2] = 1; }
            else if (starType < 0.88) { col[i * 3] = 1; col[i * 3 + 1] = 0.9; col[i * 3 + 2] = 0.7; }
            else { col[i * 3] = 1; col[i * 3 + 1] = 0.7; col[i * 3 + 2] = 0.6; }
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geom.setAttribute('color', new THREE.BufferAttribute(col, 3));

        scene.add(new THREE.Points(geom, new THREE.PointsMaterial({
            size: 0.25, transparent: true, opacity: 0.55,
            sizeAttenuation: true, depthWrite: false, vertexColors: true,
        })));
    }

    // ==================== 位置更新 ====================
    function updateSwordPositions(time) {
        const count = CONFIG.swords.count;
        const lerpSpeed = 0.06;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // 球阵位置（轨道运动）
            const theta = orbitTheta[i] + time * orbitSpeed[i];
            const phi = orbitPhi[i] + Math.sin(time * orbitSpeed[i] * 0.5 + orbitTilt[i]) * 0.15;
            const r = orbitRadius[i];
            const sx = r * Math.sin(phi) * Math.cos(theta);
            const sy = r * Math.sin(phi) * Math.sin(theta);
            const sz = r * Math.cos(phi);

            // 飞龙位置
            let dx, dy, dz;
            if (i < dragonParams.headCount) {
                // 龙头：围绕龙头位置的球形分布
                const headT = dragonParams.alongBody[i];
                const baseX = dragonParams.positions[i3] + dragonHead.x;
                const baseY = dragonParams.positions[i3 + 1] + dragonHead.y;
                const baseZ = dragonParams.positions[i3 + 2] + dragonHead.z;
                dx = baseX; dy = baseY; dz = baseZ;
            } else {
                // 龙身
                dx = dragonParams.positions[i3] + dragonHead.x;
                dy = dragonParams.positions[i3 + 1] + dragonHead.y;
                dz = dragonParams.positions[i3 + 2] + dragonHead.z;
            }

            // 根据 dragonProgress 混合
            const t = dragonProgress;
            targetPositions[i3]     = sx + (dx - sx) * t;
            targetPositions[i3 + 1] = sy + (dy - sy) * t;
            targetPositions[i3 + 2] = sz + (dz - sz) * t;

            // lerp 当前位置向目标
            currentPositions[i3]     += (targetPositions[i3]     - currentPositions[i3]) * lerpSpeed;
            currentPositions[i3 + 1] += (targetPositions[i3 + 1] - currentPositions[i3 + 1]) * lerpSpeed;
            currentPositions[i3 + 2] += (targetPositions[i3 + 2] - currentPositions[i3 + 2]) * lerpSpeed;

            // 拖尾
            trailPositions[i3]     += (currentPositions[i3]     - trailPositions[i3]) * 0.12;
            trailPositions[i3 + 1] += (currentPositions[i3 + 1] - trailPositions[i3 + 1]) * 0.12;
            trailPositions[i3 + 2] += (currentPositions[i3 + 2] - trailPositions[i3 + 2]) * 0.12;
        }

        const swordPoints = swordsGroup.children[0];
        const trailPoints = swordsGroup.children[1];
        swordPoints.geometry.attributes.position.needsUpdate = true;
        trailPoints.geometry.attributes.position.needsUpdate = true;
    }

    // ==================== 手势回调 ====================
    function onHandResults(results) {
        const state = GestureState;

        if (!state.handDetected) {
            handDetected = false;
            updateCameraStatus(false);
            dragonProgressTarget = 0;
            return;
        }

        handDetected = true;
        updateCameraStatus(true);

        // 5指张开 → 飞龙
        if (state.gestureType === 'open') {
            dragonProgressTarget = 1;

            // 食指指尖控制飞龙头部位置
            const targetX = (0.5 - state.indexTipX) * 14;
            const targetY = (state.indexTipY - 0.5) * 10;
            dragonHead.x += (targetX - dragonHead.x) * 0.05;
            dragonHead.y += (targetY - dragonHead.y) * 0.05;
        }
        // 握拳 → 球阵
        else if (state.gestureType === 'fist') {
            dragonProgressTarget = 0;
        }

        // 平滑过渡
        const transitionSpeed = dragonProgressTarget > dragonProgress
            ? CONFIG.transition.toDragon : CONFIG.transition.toSphere;
        dragonProgress += (dragonProgressTarget - dragonProgress) * transitionSpeed;
        dragonProgress = Math.max(0, Math.min(1, dragonProgress));

        // 更新 Shader
        const swordPoints = swordsGroup.children[0];
        swordPoints.material.uniforms.uDragonProgress.value = dragonProgress;

        // 更新光晕
        const glow = swordsGroup.children[2];
        if (glow && glow.material) {
            const targetOpacity = 0.15 + dragonProgress * 0.4;
            glow.material.opacity += (targetOpacity - glow.material.opacity) * 0.1;
        }

        updateGestureStatus(state);
    }

    function updateGestureStatus(state) {
        const el = document.getElementById('gesture-label');
        if (!el) return;
        const labels = {
            open: ' 飞龙',
            fist: ' 球阵',
            normal: ' 自动飞行',
        };
        el.textContent = labels[state.gestureType] || '未识别';
    }

    function updateCameraStatus(ready) {
        const el = document.getElementById('cam-state');
        if (el) {
            el.className = ready ? 'on' : 'off';
            el.textContent = ready ? '已连接' : '未连接';
        }
    }

    // ==================== 预览绘制 ====================
    function initPreview() {
        previewCanvas = document.getElementById('preview-canvas');
        previewCtx = previewCanvas.getContext('2d');
        previewCanvas.width = 220;
        previewCanvas.height = 165;
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

            const connections = [
                [0,1],[1,2],[2,3],[3,4],
                [0,5],[5,6],[6,7],[7,8],
                [5,9],[9,10],[10,11],[11,12],
                [9,13],[13,14],[14,15],[15,16],
                [13,17],[17,18],[18,19],[19,20],
                [0,17],
            ];
            ctx.strokeStyle = '#22cc88';
            ctx.lineWidth = 1.5;
            connections.forEach(([a, b]) => {
                ctx.beginPath();
                ctx.moveTo(lm[a].x * w, lm[a].y * h);
                ctx.lineTo(lm[b].x * w, lm[b].y * h);
                ctx.stroke();
            });

            // 食指指尖 - 高亮
            ctx.beginPath();
            ctx.arc(lm[8].x * w, lm[8].y * h, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#00ff88';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    // ==================== 动画循环 ====================
    function animate() {
        requestAnimationFrame(animate);
        const time = performance.now() * 0.001;

        // 更新 shader 时间
        swordsGroup.children.forEach((child) => {
            if (child.material && child.material.uniforms && child.material.uniforms.uTime) {
                child.material.uniforms.uTime.value = time;
            }
        });

        // 更新飞剑位置（包含轨道运动 + 飞龙混合）
        updateSwordPositions(time);

        // 无手时自动旋转
        if (!handDetected) {
            swordsGroup.rotation.y += 0.004;
        }

        renderer.render(scene, camera);
    }

    function onResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ==================== 鼠标控制 ====================
    function setupMouseControls() {
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
            swordsGroup.rotation.y -= dx * 0.005;
            swordsGroup.rotation.x -= dy * 0.005;
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
        }, { passive: false });

        canvas3d.addEventListener('dblclick', toggleFullscreen);

        document.addEventListener('fullscreenchange', () => {
            document.body.classList.toggle('fullscreen', !!document.fullscreenElement);
        });
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

    window.addEventListener('DOMContentLoaded', init);
})();

/**
 * 手势识别模块 — 青竹蜂云剑阵
 * 使用 MediaPipe Hands 检测手部关键点
 * 新增：食指指尖追踪（控制飞龙方向）
 */

const GestureState = {
    handDetected: false,
    gestureType: 'normal',   // 'open' | 'fist' | 'normal'
    openness: 0.5,
    // 食指指尖位置（用于飞龙控制）
    indexTipX: 0.5,
    indexTipY: 0.5,
    indexTipZ: 0.5,
};

const _gestureStability = {
    pendingType: null,
    consecutiveFrames: 0,
    requiredFrames: 3,
};

const ROTATION_SMOOTH = 0.45;
let _smoothedRotationZ = null;

function distance3D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = (a.z || 0) - (b.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function calcFingerOpenness(landmarks) {
    const wrist = landmarks[0];
    const fingertips = [8, 12, 16, 20];
    const fingerBases = [5, 9, 13, 17];
    let totalRatio = 0;
    for (let i = 0; i < fingertips.length; i++) {
        const tipDist = distance3D(landmarks[fingertips[i]], wrist);
        const baseDist = distance3D(landmarks[fingerBases[i]], wrist);
        if (baseDist > 0.0001) totalRatio += tipDist / baseDist;
    }
    const thumbTipDist = distance3D(landmarks[4], wrist);
    const thumbBaseDist = distance3D(landmarks[2], wrist);
    if (thumbBaseDist > 0.0001) totalRatio += thumbTipDist / thumbBaseDist;
    const avgRatio = totalRatio / 5;
    return Math.max(0, Math.min(1, (avgRatio - 0.6) / 1.2));
}

function calcHandRotationZ(landmarks) {
    const wrist = landmarks[0];
    const middleMcp = landmarks[9];
    const dx = -(middleMcp.x - wrist.x);
    const dy = middleMcp.y - wrist.y;
    return Math.atan2(dy, dx);
}

function stabilizeGesture(rawType) {
    const st = _gestureStability;
    if (rawType === st.pendingType) {
        st.consecutiveFrames++;
    } else {
        st.pendingType = rawType;
        st.consecutiveFrames = 1;
    }
    if (st.consecutiveFrames >= st.requiredFrames) {
        return rawType;
    }
    return GestureState.gestureType;
}

function initHandTracking(onResults) {
    const videoElement = document.getElementById('video');

    if (typeof Hands === 'undefined') {
        console.error('MediaPipe Hands 未加载');
        return;
    }

    const hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`,
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
    });

    hands.onResults((results) => {
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const lm = results.multiHandLandmarks[0];

            GestureState.handDetected = true;
            GestureState.openness = calcFingerOpenness(lm);

            // 食指指尖（镜像）
            GestureState.indexTipX = 1 - lm[8].x;
            GestureState.indexTipY = lm[8].y;
            GestureState.indexTipZ = lm[8].z;

            // 手势分类
            const rawType = GestureState.openness > 0.7 ? 'open' :
                            GestureState.openness < 0.25 ? 'fist' : 'normal';
            GestureState.gestureType = stabilizeGesture(rawType);
        } else {
            GestureState.handDetected = false;
            GestureState.gestureType = 'normal';
            _gestureStability.pendingType = null;
            _gestureStability.consecutiveFrames = 0;
        }

        if (onResults) onResults(results);
    });

    if (typeof Camera === 'undefined') {
        console.error('MediaPipe Camera Utils 未加载');
        return;
    }

    const camera = new Camera(videoElement, {
        onFrame: async () => { await hands.send({ image: videoElement }); },
        width: 640,
        height: 480,
    });
    camera.start();
}

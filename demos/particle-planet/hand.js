/**
 * 手势识别模块
 * 使用 MediaPipe Hands 检测手部关键点
 */

const GestureState = {
    handDetected: false,
    gestureType: 'normal',
    handRotationZ: 0,       // 平滑后的手部旋转角
    openness: 0.5,
};

const _gestureStability = {
    pendingType: null,
    consecutiveFrames: 0,
    requiredFrames: 2,
};

// 手部旋转指数平滑
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

            // 旋转角指数平滑
            const rawRot = calcHandRotationZ(lm);
            if (_smoothedRotationZ === null) {
                _smoothedRotationZ = rawRot;
            } else {
                _smoothedRotationZ += (rawRot - _smoothedRotationZ) * ROTATION_SMOOTH;
            }
            GestureState.handRotationZ = _smoothedRotationZ;
            GestureState.openness = calcFingerOpenness(lm);

            const rawType = GestureState.openness > 0.6 ? 'open' :
                            GestureState.openness < 0.3 ? 'fist' : 'normal';
            GestureState.gestureType = stabilizeGesture(rawType);
        } else {
            GestureState.handDetected = false;
            GestureState.gestureType = 'normal';
            _smoothedRotationZ = null;  // 手消失时重置，避免下次检测时跳跃
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

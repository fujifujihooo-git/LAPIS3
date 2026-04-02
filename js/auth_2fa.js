/**
 * auth_2fa.js
 * 
 * 2段階認証 (2FA) およびデバイス信頼管理用モジュール
 * - デバイスフィンガープリント (UUID)
 * - Firestore: trusted_devices, otp_codes
 * - GAS Email API Integration
 */

const AUTH_2FA = {
    // 定数
    COLLECTION_TRUSTED: 'trusted_devices',
    COLLECTION_OTP: 'otp_codes',
    GAS_API_URL: 'https://script.google.com/macros/s/AKfycbxZO2KX9l01h7U9768DfHHnjG8I24k2hXux6ApL0Rl-TCkXs3GY_NHHXXfhzvQvDOv5yQ/exec', // 実際のURL
    SECRET_KEY: 'lapis_secret_2026',

    // 信頼期間 (30日)
    TRUST_DURATION_DAYS: 30,
    // OTP有効期限 (10分)
    OTP_DURATION_MINUTES: 10,

    /**
     * デバイスIDを取得または生成する
     * localStorageに 'lapis2_device_id' があればそれを返す。なければ新規UUIDを生成して保存。
     */
    getDeviceId: function () {
        let deviceId = localStorage.getItem('lapis2_device_id');
        if (!deviceId) {
            deviceId = crypto.randomUUID ? crypto.randomUUID() : this._generateLegacyUUID();
            localStorage.setItem('lapis2_device_id', deviceId);
        }
        return deviceId;
    },

    /**
     * レガシーブラウザ向けUUID生成 (フォールバック)
     */
    _generateLegacyUUID: function () {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    /**
     * 現在のデバイスが信頼済みかチェックする
     * @param {string} userId - ユーザーのメールアドレスまたはUID
     * @returns {Promise<boolean>} - 信頼済みなら true
     */
    checkTrustedDevice: async function (userId) {
        if (!userId) return false;
        const deviceId = this.getDeviceId();
        console.log(`Checking trust for DeviceID: ${deviceId}, User: ${userId}`);

        try {
            const docRef = db.collection(this.COLLECTION_TRUSTED).doc(deviceId);
            const doc = await docRef.get();

            if (doc.exists) {
                const data = doc.data();
                // ユーザーID一致 かつ 有効期限内
                if (data.userId === userId) {
                    const now = new Date();
                    let expiresAt;

                    // Robust Date Parsing
                    if (data.expiresAt && typeof data.expiresAt.toDate === 'function') {
                        expiresAt = data.expiresAt.toDate(); // Firestore Timestamp
                    } else if (data.expiresAt) {
                        expiresAt = new Date(data.expiresAt); // Date string or object
                    } else {
                        console.log('No expiresAt field found');
                        return false;
                    }

                    if (now < expiresAt) {
                        return true;
                    } else {
                        console.log('Trust expired:', expiresAt);
                    }
                } else {
                    console.log('Trust user mismatch:', data.userId);
                }
            } else {
                console.log('Device not found in trusted_devices.');
            }
        } catch (error) {
            console.error('Error checking trusted device:', error);
            // エラー時は安全側に倒して false (認証要求)
        }
        return false;
    },

    /**
     * 現在のデバイスを信頼済みとして登録・更新する
     * @param {string} userId
     */
    registerTrustedDevice: async function (userId) {
        const deviceId = this.getDeviceId();
        const now = new Date();
        const expiresAt = new Date(now);
        expiresAt.setDate(expiresAt.getDate() + this.TRUST_DURATION_DAYS);

        try {
            await db.collection(this.COLLECTION_TRUSTED).doc(deviceId).set({
                userId: userId,
                deviceId: deviceId,
                deviceFingerprint: navigator.userAgent, // 将来的な分析用
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                expiresAt: firebase.firestore.Timestamp.fromDate(expiresAt), // Ensure Timestamp format
                lastUsedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('Device registered as trusted until:', expiresAt);
            console.log('Firestore Write Success'); // Confirmation Log
        } catch (error) {
            console.error('Error registering trusted device:', error);
            throw error;
        }
    },

    /**
     * OTPを生成し、Firestoreに保存後、GAS経由でメール送信する
     * @param {string} userId
     * @param {string} email
     * @returns {Promise<void>}
     */
    sendOtp: async function (userId, email) {
        console.log('Preparing to send OTP for:', email);
        // 1. Generate 6-digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();

        // 2. Save to Firestore
        const now = new Date();
        const expiresAt = new Date(now);
        expiresAt.setMinutes(expiresAt.getMinutes() + this.OTP_DURATION_MINUTES);

        try {
            // userIdごとのドキュメントに保存 (上書き)
            await db.collection(this.COLLECTION_OTP).doc(userId).set({
                code: code,
                email: email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                expiresAt: expiresAt
            });
            console.log('OTP saved to Firestore.');

            // 3. Send via GAS API
            const payload = {
                email: email,
                code: code,
                secretKey: this.SECRET_KEY
            };

            // Switch to standard CORS request to wait for completion
            // Note: GAS output must be JSON.
            const response = await fetch(this.GAS_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8', // GAS often prefers text/plain to avoid preflight issues for simple POSTs
                },
                body: JSON.stringify(payload)
            });

            console.log('GAS Request sent. Status:', response.status);

            if (!response.ok) {
                // If 4xx or 5xx, try to read text
                const errText = await response.text();
                console.warn('GAS Error Response:', errText);
                throw new Error(`Server returned ${response.status}: ${errText}`);
            }

            // Try to parse JSON if possible, but just waiting for response.ok is often enough for "completion"
            try {
                const json = await response.json();
                console.log('GAS Response:', json);
            } catch (e) {
                console.log('GAS response was not JSON, but status was OK.');
            }

            console.log('OTP sent successfully via GAS.');

        } catch (error) {
            console.error('Error sending OTP:', error);
            // Even if GAS fails (e.g. CORS), we might want to allow code input if Firestore save worked?
            // But user requirement is strict: "wait until Success".
            // If CORS fails, it throws.
            // We will alert the user.
            throw new Error('メール送信連携に失敗しました: ' + error.message);
        }
    },

    /**
     * 入力されたOTPを検証する
     * @param {string} userId 
     * @param {string} inputCode 
     * @returns {Promise<boolean>}
     */
    verifyOtp: async function (userId, inputCode) {
        if (!inputCode) return false;

        try {
            const docRef = db.collection(this.COLLECTION_OTP).doc(userId);
            const doc = await docRef.get();

            if (!doc.exists) {
                console.warn('No OTP found for user');
                return false;
            }

            const data = doc.data();
            const now = new Date();
            const expiresAt = data.expiresAt.toDate();

            if (now > expiresAt) {
                console.warn('OTP expired');
                return false;
            }

            if (data.code === inputCode) {
                // Success: Clean up used OTP
                await docRef.delete();
                return true;
            } else {
                console.warn('Invalid OTP');
                return false;
            }
        } catch (error) {
            console.error('Error verifying OTP:', error);
            throw error;
        }
    }
};

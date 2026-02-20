document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('login-email');
    const passInput = document.getElementById('login-pass');

    // --- UI Elements for 2FA ---
    const otpModal = document.getElementById('otp-modal');
    const otpForm = document.getElementById('otp-form');
    const otpInput = document.getElementById('otp-code');
    const btnResend = document.getElementById('btn-resend-otp');
    const linkBack = document.getElementById('link-back-login');

    let tempUserEmail = '';
    let tempUserId = '';

    // --- Login Flow ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Disable UI
        const btnLogin = document.querySelector('.btn-login');
        if (btnLogin) { btnLogin.disabled = true; btnLogin.innerHTML = '処理中...'; }
        emailInput.disabled = true;
        passInput.disabled = true;

        const email = emailInput.value.trim();
        const pass = passInput.value.trim();

        console.log('Login Attempt (2FA Mode):', { email });

        if (typeof firebase.auth !== 'function') {
            alert('認証SDKの読み込みに失敗しました。ページをリロードしてください。');
            resetLoginUI();
            return;
        }

        try {
            // Set 2FA Pending Flag EARLY to prevent common.js auto-redirect
            sessionStorage.setItem('lapis2_2fa_pending', 'true');

            // 1. Basic Auth
            const userCredential = await firebase.auth().signInWithEmailAndPassword(email, pass);
            const user = userCredential.user;
            tempUserEmail = user.email;
            tempUserId = user.uid;
            const userIdentifier = user.email;

            console.log('Firebase Auth Success:', userIdentifier);

            // 2. Check Trusted Device
            const isTrusted = await AUTH_2FA.checkTrustedDevice(userIdentifier);
            console.log(`Trusted status for ${userIdentifier}: ${isTrusted}`);

            if (isTrusted) {
                console.log('Device is trusted. Skipping OTP.');
                await finalizeLogin(userIdentifier);
            } else {
                console.log('Device not trusted. Initiating OTP.');

                // Show OTP Modal first (to indicate progress?) 
                // Wait, if we wait for email sent, maybe keep loading on main screen?
                // User said: "GAS request complete... before transition".
                // Transitions usually mean "To Index" or "To Modal".
                // I'll keep the spinner on the main button until email is sent.

                try {
                    // Send OTP and WAIT for success
                    await AUTH_2FA.sendOtp(userIdentifier, userIdentifier);

                    console.log('OTP Send completed. Showing modal.');
                    alert('認証コードをメールで送信しました。');

                    // Show OTP Modal - User MUST interact here to proceed
                    showOtpModal();

                    // STRICTLY STOP HERE. 
                    // No redirect. No further processing.
                    return;

                } catch (otpErr) {
                    console.error(otpErr);
                    await firebase.auth().signOut(); // Security: sign out if OTP fails
                    alert('認証コードの送信に失敗しました: ' + otpErr.message);
                    resetLoginUI();
                    return;
                }
            }

        } catch (err) {
            handleLoginError(err);
            resetLoginUI();
        }
    });

    function resetLoginUI() {
        const btnLogin = document.querySelector('.btn-login');
        if (btnLogin) { btnLogin.disabled = false; btnLogin.innerHTML = 'ログイン'; }
        emailInput.disabled = false;
        passInput.disabled = false;
    }

    // --- OTP Flow ---
    otpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = otpInput.value.trim();
        const userIdentifier = tempUserEmail;

        if (!code || code.length !== 6) {
            alert('6桁の数値を入力してください。');
            return;
        }

        try {
            const isValid = await AUTH_2FA.verifyOtp(userIdentifier, code);
            if (isValid) {
                // Register Device ONLY if checkbox is checked
                const trustDeviceCheckbox = document.getElementById('trust-device-check');
                console.log('Trust Device Checkbox:', trustDeviceCheckbox ? trustDeviceCheckbox.checked : 'not found');

                if (trustDeviceCheckbox && trustDeviceCheckbox.checked) {
                    await AUTH_2FA.registerTrustedDevice(userIdentifier);
                }

                await finalizeLogin(userIdentifier);
            } else {
                alert('認証コードが間違っています。または有効期限切れです。');
            }
        } catch (err) {
            console.error(err);
            alert('認証処理中にエラーが発生しました。');
        }
    });

    btnResend.addEventListener('click', async () => {
        if (!tempUserEmail) return;
        if (!confirm('認証コードを再送信しますか？')) return;

        try {
            await AUTH_2FA.sendOtp(tempUserEmail, tempUserEmail);
            alert('認証コードを再送信しました。');
        } catch (err) {
            alert('送信失敗: ' + err.message);
        }
    });

    linkBack.addEventListener('click', (e) => {
        e.preventDefault();
        otpModal.style.display = 'none';
        firebase.auth().signOut(); // Cancel login session
    });

    function showOtpModal() {
        otpModal.style.display = 'block';
        otpInput.value = '';
        otpInput.focus();
    }

    // --- Finalization ---
    async function finalizeLogin(email) {
        try {
            // ログインしたユーザーの追加情報を Firestore から取得
            const staffData = await getDocFromFirestore('staff', 'email', email);

            if (!staffData) {
                console.warn(`Staff document missing for UID/Email: ${email}`);
                await firebase.auth().signOut();
                // Detailed error for debugging
                alert(`ログイン不可: スタッフデータが見つかりません。\nTarget Email: ${email}\n(Firestore: staff collection check failed)`);
                otpModal.style.display = 'none';
                return;
            }

            if (staffData.status !== '在籍') {
                console.warn(`Staff status invalid: ${staffData.status}`);
                await firebase.auth().signOut();
                alert(`ログイン不可: アカウントのステータスが無効です。\nCurrent Status: ${staffData.status}`);
                otpModal.style.display = 'none';
                sessionStorage.removeItem('lapis2_2fa_pending');
                return;
            }

            // Verify Name
            const staffName = staffData.staff_name || 'Staff Member';
            if (!staffData.staff_name) {
                console.warn('Warning: staff_name is missing for user', email);
            }

            // Clear 2FA Pending Flag
            sessionStorage.removeItem('lapis2_2fa_pending');

            // Success case
            const sessionData = {
                staff_id: staffData.staff_id,
                staff_name: staffName,
                email: staffData.email,
                login_at: new Date().toISOString()
            };
            localStorage.setItem('lapis2_session', JSON.stringify(sessionData));

            // Show success UI in modal or toast
            if (otpModal.style.display === 'block') {
                otpForm.innerHTML = '<div style="text-align:center; padding:20px; color:var(--success); font-weight:bold; font-size:1.2rem;">認証成功！<br>ログインします...</div>';
            } else {
                showToast('ログインしました', 'success');
            }

            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1000);
        } catch (err) {
            console.error('Finalize error:', err);
            alert('ユーザー情報の取得に失敗しました。');
        }
    }

    function handleLoginError(err) {
        console.error('Login error:', err);
        let message = 'ログインに失敗しました。';
        if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
            message = 'メールアドレスまたはパスワードが正しくありません。';
        } else if (err.code === 'auth/invalid-email') {
            message = 'メールアドレスの形式が正しくありません。';
        }
        alert(message);
    }
});

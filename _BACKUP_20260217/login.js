document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('login-email');
    const passInput = document.getElementById('login-pass');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = emailInput.value.trim();
        const pass = passInput.value.trim();

        console.log('Login Attempt (Firestore Mode):', { email });

        // Guard: firebase.auth may not be loaded yet
        if (typeof firebase.auth !== 'function') {
            alert('認証SDKの読み込みに失敗しました。ページをリロードしてください。');
            return;
        }

        try {
            // Firebase Auth でログイン実行
            const userCredential = await firebase.auth().signInWithEmailAndPassword(email, pass);
            const user = userCredential.user;

            console.log('Firebase Auth Login Success:', user.email);

            // ログインしたユーザーの追加情報を Firestore から取得
            const staffData = await getDocFromFirestore('staff', 'email', email);

            if (staffData && staffData.status === '在籍') {
                const sessionData = {
                    staff_id: staffData.staff_id,
                    staff_name: staffData.staff_name,
                    email: staffData.email,
                    login_at: new Date().toISOString()
                };
                localStorage.setItem('lapis2_session', JSON.stringify(sessionData));
                showToast('ログインしました', 'success');
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 500);
            } else {
                console.warn('User disabled or data missing in Firestore');
                await firebase.auth().signOut();
                alert('ログインに失敗しました。\nアカウントが無効化されているか、データが見つかりません。');
            }
        } catch (err) {
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
});

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LogIn,
  School,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';

export interface SchoolUserOption {
  id: string;
  name?: string;
  username?: string;
  role?: string;
}

interface AuthPopupModalProps {
  isOpen: boolean;
  mode: 'login' | 'signup';
  onModeChange: (mode: 'login' | 'signup') => void;
  onClose: () => void;
  usersList: SchoolUserOption[];
  onLoginSubmit: (params: {
    selectedUserId: string;
    schoolCode: string;
    password: string;
  }) => { ok: boolean; error?: string };
  onSignUpSubmit: (params: {
    schoolCode: string;
    schoolName: string;
    password: string;
  }) => Promise<{ ok: boolean; error?: string; createdUser?: SchoolUserOption }>;
  onInjectDemo?: () => void;
}

export const AuthPopupModal: React.FC<AuthPopupModalProps> = ({
  isOpen,
  mode,
  onModeChange,
  onClose,
  usersList,
  onLoginSubmit,
  onSignUpSubmit,
  onInjectDemo,
}) => {
  // Login state
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loginSchoolCode, setLoginSchoolCode] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPass, setShowLoginPass] = useState(false);
  const [loginErrorMsg, setLoginErrorMsg] = useState('');
  const [loginShakeKey, setLoginShakeKey] = useState(0);
  const [loginSuccessBanner, setLoginSuccessBanner] = useState('');

  // Sign up state
  const [signupCode, setSignupCode] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [showSignupPass, setShowSignupPass] = useState(false);
  const [signupErrorMsg, setSignupErrorMsg] = useState('');
  const [signupShakeKey, setSignupShakeKey] = useState(0);
  const [isSavingSignup, setIsSavingSignup] = useState(false);
  const [showQrPopup, setShowQrPopup] = useState(false);

  const loginPassInputRef = useRef<HTMLInputElement>(null);
  const loginCodeInputRef = useRef<HTMLInputElement>(null);
  const signupCodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setShowQrPopup(false);
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showQrPopup) {
          setShowQrPopup(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, showQrPopup]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (mode === 'login') {
        if (loginSchoolCode) {
          loginPassInputRef.current?.focus();
        } else {
          loginCodeInputRef.current?.focus();
        }
      } else {
        signupCodeInputRef.current?.focus();
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const isSignUp = mode === 'signup';

  const handleLoginFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErrorMsg('');
    setLoginSuccessBanner('');

    const result = onLoginSubmit({
      selectedUserId,
      schoolCode: loginSchoolCode,
      password: loginPassword,
    });

    if (!result.ok) {
      setLoginErrorMsg(result.error || 'Maklumat log masuk tidak sah.');
      setLoginShakeKey((k) => k + 1);
      if (result.error?.toLowerCase().includes('kata laluan')) {
        setLoginPassword('');
        loginPassInputRef.current?.focus();
      }
      return;
    }

    setLoginPassword('');
    setLoginErrorMsg('');
  };

  const handleSignUpFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupErrorMsg('');

    const code = signupCode.trim().toUpperCase();
    const name = signupName.trim().toUpperCase();
    const pass = signupPassword.trim();

    if (!code || !name || !pass) {
      setSignupErrorMsg('Semua ruangan Kod Sekolah, Nama Sekolah, dan Kata Laluan wajib diisi.');
      setSignupShakeKey((k) => k + 1);
      return;
    }

    if (pass.length < 4) {
      setSignupErrorMsg('Kata laluan hendaklah sekurang-kurangnya 4 aksara.');
      setSignupShakeKey((k) => k + 1);
      return;
    }

    setIsSavingSignup(true);
    const result = await onSignUpSubmit({
      schoolCode: code,
      schoolName: name,
      password: pass,
    });
    setIsSavingSignup(false);

    if (!result.ok) {
      setSignupErrorMsg(result.error || 'Pendaftaran gagal. Sila cuba semula.');
      setSignupShakeKey((k) => k + 1);
      return;
    }

    // Pre-fill login form with the newly registered school and glide to Login panel
    setLoginSchoolCode(code);
    if (result.createdUser?.id) {
      setSelectedUserId(result.createdUser.id);
    }
    setLoginPassword('');
    setSignupCode('');
    setSignupName('');
    setSignupPassword('');
    setSignupErrorMsg('');
    setLoginErrorMsg('');
    setLoginSuccessBanner(`Sekolah ${code} berjaya didaftarkan. Sila log masuk.`);
    onModeChange('login');
  };

  const handleCodeChange = (val: string) => {
    setLoginSchoolCode(val);
    setLoginErrorMsg('');
    const norm = val.trim().toUpperCase();
    const matched = usersList.find(
      (u) =>
        (u.name || '').toUpperCase() === norm ||
        (u.username || '').toUpperCase() === norm ||
        `${(u.name || '').toUpperCase()} - ${(u.username || '').toUpperCase()}` === norm
    );
    setSelectedUserId(matched ? matched.id : '');
  };

  const handleSelectChange = (id: string) => {
    setSelectedUserId(id);
    setLoginErrorMsg('');
    const found = usersList.find((u) => u.id === id);
    setLoginSchoolCode(found ? found.name || '' : '');
  };

  const renderLoginForm = (isMobile = false) => (
    <form
      onSubmit={handleLoginFormSubmit}
      className={`flex flex-col justify-center h-full ${isMobile ? 'p-6' : 'px-10 py-9'}`}
      noValidate
    >
      <div className="mb-5">
        <div className="flex items-center gap-2 text-indigo-600 mb-2">
          <Calendar className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="text-xs font-semibold tracking-wide text-indigo-700">
            Sistem Pemetaan Jadual
          </span>
        </div>
        <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight leading-snug text-balance">
          Log Masuk Portal
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Akses pangkalan data jadual dan pemetaan guru sekolah anda.
        </p>
      </div>

      {loginSuccessBanner && (
        <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{loginSuccessBanner}</span>
        </div>
      )}

      {loginErrorMsg && (
        <div
          key={loginShakeKey}
          className="auth-shake mb-4 px-3.5 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-2"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{loginErrorMsg}</span>
        </div>
      )}

      <div className="space-y-3.5">
        <div>
          <label
            htmlFor={isMobile ? 'popup-login-code-mobile' : 'popup-login-code'}
            className="block text-xs font-semibold text-slate-700 mb-1.5"
          >
            Kod Sekolah
          </label>
          <div className="relative">
            <School
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              ref={!isMobile ? loginCodeInputRef : undefined}
              id={isMobile ? 'popup-login-code-mobile' : 'popup-login-code'}
              type="text"
              autoComplete="username"
              value={loginSchoolCode}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder="Taip kod sekolah (cth: ABA1001)"
              className="w-full pl-10 pr-3.5 py-2.5 text-sm font-semibold uppercase text-slate-900 bg-slate-50 border border-slate-200 rounded-xl placeholder:normal-case placeholder:font-normal placeholder:text-slate-400 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/12 focus:outline-none transition-all"
            />
          </div>
          {usersList.length > 0 && (
            <select
              aria-label="Pilih Sekolah Dari Senarai"
              value={selectedUserId}
              onChange={(e) => handleSelectChange(e.target.value)}
              className="mt-2 w-full px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/12 focus:outline-none transition-all"
            >
              <option value="">Atau pilih daripada senarai sekolah berdaftar ({usersList.length})</option>
              {usersList.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} — {user.username}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label
            htmlFor={isMobile ? 'popup-login-pass-mobile' : 'popup-login-pass'}
            className="block text-xs font-semibold text-slate-700 mb-1.5"
          >
            Kata Laluan Sekolah
          </label>
          <div className="relative">
            <KeyRound
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              ref={!isMobile ? loginPassInputRef : undefined}
              id={isMobile ? 'popup-login-pass-mobile' : 'popup-login-pass'}
              type={showLoginPass ? 'text' : 'password'}
              autoComplete="current-password"
              value={loginPassword}
              onChange={(e) => {
                setLoginPassword(e.target.value);
                if (loginErrorMsg) setLoginErrorMsg('');
              }}
              placeholder="Masukkan kata laluan"
              className="w-full pl-10 pr-11 py-2.5 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-xl placeholder:text-slate-400 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/12 focus:outline-none transition-all"
            />
            <button
              type="button"
              onClick={() => setShowLoginPass((v) => !v)}
              aria-label={showLoginPass ? 'Sembunyikan kata laluan' : 'Tunjukkan kata laluan'}
              className="absolute inset-y-0 right-1 px-2.5 flex items-center text-slate-400 hover:text-slate-700 transition-colors focus-visible:outline-none focus-visible:text-indigo-600"
            >
              {showLoginPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {usersList.length === 0 && (
        <div className="mt-3.5 p-3 rounded-xl bg-amber-50 border border-amber-200/80 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-amber-900">
            Belum ada sekolah berdaftar.
          </span>
          {onInjectDemo && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onInjectDemo();
              }}
              className="text-xs font-semibold text-amber-800 hover:text-amber-950 underline underline-offset-2 whitespace-nowrap shrink-0 flex items-center gap-1"
            >
              <Zap className="w-3.5 h-3.5" aria-hidden="true" />
              Guna Data Demo
            </button>
          )}
        </div>
      )}

      <button
        type="submit"
        className="mt-5 w-full py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white text-sm font-semibold rounded-xl shadow-sm shadow-indigo-600/20 flex items-center justify-center gap-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 cursor-pointer"
      >
        <LogIn className="w-4 h-4" aria-hidden="true" />
        <span>Log Masuk</span>
      </button>

      <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span>Belum mendaftar sekolah?</span>
        <button
          type="button"
          onClick={() => {
            setLoginErrorMsg('');
            onModeChange('signup');
          }}
          className="font-semibold text-indigo-600 hover:text-indigo-800 transition-colors inline-flex items-center gap-1 cursor-pointer"
        >
          <span>Daftar Sekarang</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 flex justify-center overflow-hidden">
        <button
          type="button"
          onClick={() => setShowQrPopup(true)}
          aria-label="Paparkan Kod QR Buy Me a Coffee"
          title="Klik untuk paparkan Kod QR"
          className="cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-transform duration-150 hover:scale-[1.03] active:scale-[0.98]"
        >
          <img
            src="/assets/aistudio/buy-me-a-coffee-logo-6100_247c69aa.jpg"
            alt="Like what you see? Buy Me a Coffee"
            className="h-36 w-auto max-w-full object-contain -my-8 select-none pointer-events-none"
          />
        </button>
      </div>
    </form>
  );

  const renderSignUpForm = (isMobile = false) => (
    <form
      onSubmit={handleSignUpFormSubmit}
      className={`flex flex-col justify-center h-full ${isMobile ? 'p-6' : 'px-10 py-9'}`}
      noValidate
    >
      <div className="mb-5">
        <div className="flex items-center gap-2 text-indigo-600 mb-2">
          <Building2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="text-xs font-semibold tracking-wide text-indigo-700">
            Pendaftaran Baharu
          </span>
        </div>
        <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight leading-snug text-balance">
          Daftar Akaun Sekolah
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Cipta profil sekolah anda untuk mula memetakan guru dan kelas.
        </p>
      </div>

      {signupErrorMsg && (
        <div
          key={signupShakeKey}
          className="auth-shake mb-4 px-3.5 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-2"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{signupErrorMsg}</span>
        </div>
      )}

      <div className="space-y-3.5">
        <div>
          <label
            htmlFor={isMobile ? 'popup-signup-code-mobile' : 'popup-signup-code'}
            className="block text-xs font-semibold text-slate-700 mb-1.5"
          >
            Kod Sekolah
          </label>
          <div className="relative">
            <School
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              ref={!isMobile ? signupCodeInputRef : undefined}
              id={isMobile ? 'popup-signup-code-mobile' : 'popup-signup-code'}
              type="text"
              value={signupCode}
              onChange={(e) => {
                setSignupCode(e.target.value);
                if (signupErrorMsg) setSignupErrorMsg('');
              }}
              placeholder="Contoh: ABA1001"
              className="w-full pl-10 pr-3.5 py-2.5 text-sm font-semibold uppercase text-slate-900 bg-slate-50 border border-slate-200 rounded-xl placeholder:normal-case placeholder:font-normal placeholder:text-slate-400 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/12 focus:outline-none transition-all"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor={isMobile ? 'popup-signup-name-mobile' : 'popup-signup-name'}
            className="block text-xs font-semibold text-slate-700 mb-1.5"
          >
            Nama Penuh Sekolah
          </label>
          <div className="relative">
            <Building2
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              id={isMobile ? 'popup-signup-name-mobile' : 'popup-signup-name'}
              type="text"
              value={signupName}
              onChange={(e) => {
                setSignupName(e.target.value);
                if (signupErrorMsg) setSignupErrorMsg('');
              }}
              placeholder="Contoh: SK CONVENT SENTUL"
              className="w-full pl-10 pr-3.5 py-2.5 text-sm font-semibold uppercase text-slate-900 bg-slate-50 border border-slate-200 rounded-xl placeholder:normal-case placeholder:font-normal placeholder:text-slate-400 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/12 focus:outline-none transition-all"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor={isMobile ? 'popup-signup-pass-mobile' : 'popup-signup-pass'}
            className="block text-xs font-semibold text-slate-700 mb-1.5"
          >
            Kata Laluan Sekolah
          </label>
          <div className="relative">
            <KeyRound
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              id={isMobile ? 'popup-signup-pass-mobile' : 'popup-signup-pass'}
              type={showSignupPass ? 'text' : 'password'}
              autoComplete="new-password"
              value={signupPassword}
              onChange={(e) => {
                setSignupPassword(e.target.value);
                if (signupErrorMsg) setSignupErrorMsg('');
              }}
              placeholder="Minimum 4 aksara"
              className="w-full pl-10 pr-11 py-2.5 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-xl placeholder:text-slate-400 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/12 focus:outline-none transition-all"
            />
            <button
              type="button"
              onClick={() => setShowSignupPass((v) => !v)}
              aria-label={showSignupPass ? 'Sembunyikan kata laluan' : 'Tunjukkan kata laluan'}
              className="absolute inset-y-0 right-1 px-2.5 flex items-center text-slate-400 hover:text-slate-700 transition-colors focus-visible:outline-none focus-visible:text-indigo-600"
            >
              {showSignupPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={isSavingSignup}
        className="mt-5 w-full py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-60 text-white text-sm font-semibold rounded-xl shadow-sm shadow-indigo-600/20 flex items-center justify-center gap-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 cursor-pointer"
      >
        <UserPlus className="w-4 h-4" aria-hidden="true" />
        <span>{isSavingSignup ? 'Menyimpan Pendaftaran...' : 'Daftar Sekolah Baru'}</span>
      </button>

      <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span>Sudah mempunyai akaun?</span>
        <button
          type="button"
          onClick={() => {
            setSignupErrorMsg('');
            onModeChange('login');
          }}
          className="font-semibold text-indigo-600 hover:text-indigo-800 transition-colors inline-flex items-center gap-1 cursor-pointer"
        >
          <span>Log Masuk</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </form>
  );

  return (
    <div
      className="auth-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={isSignUp ? 'Daftar Akaun Sekolah' : 'Log Masuk Portal'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`auth-modal-shell relative w-full max-w-[860px] bg-white rounded-2xl shadow-2xl shadow-slate-950/30 border border-slate-200/80 overflow-hidden ${
          isSignUp ? 'auth-is-signup' : ''
        }`}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup tetingkap log masuk"
          className={`absolute top-4 right-4 z-30 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            !isSignUp
              ? 'md:bg-white/10 md:text-white/80 md:hover:bg-white/20 md:hover:text-white bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-900'
              : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-900'
          }`}
        >
          <X className="w-4 h-4" />
        </button>

        {/* DESKTOP ANIMATED DUAL-PANEL STAGE */}
        <div className="hidden md:block relative w-full min-h-[600px]">
          {/* Left Half: Login Form */}
          <div className="auth-form-panel auth-panel-signin absolute inset-y-0 left-0 w-1/2 bg-white">
            {renderLoginForm(false)}
          </div>

          {/* Right Half: Sign Up Form */}
          <div className="auth-form-panel auth-panel-signup absolute inset-y-0 right-0 w-1/2 bg-white">
            {renderSignUpForm(false)}
          </div>

          {/* Sliding Overlay Curtain Panel */}
          <div className="auth-overlay-wrapper absolute inset-y-0 left-0 w-1/2 overflow-hidden z-20 shadow-xl">
            <div className="auth-overlay-track relative w-[200%] h-full bg-slate-900 text-white">
              {/* Subtle Architectural Gradient & Ambient Motion Shapes */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    'radial-gradient(circle at 20% 20%, rgba(99, 102, 241, 0.34), transparent 52%), radial-gradient(circle at 80% 80%, rgba(79, 70, 229, 0.28), transparent 55%), linear-gradient(140deg, #0f172a 0%, #1e1b4b 55%, #0f172a 100%)',
                }}
              />
              <div
                className="auth-orb-1 absolute -top-16 left-[10%] w-56 h-56 rounded-full bg-indigo-500/20 blur-2xl pointer-events-none"
                aria-hidden="true"
              />
              <div
                className="auth-orb-2 absolute -bottom-20 right-[12%] w-64 h-64 rounded-full bg-blue-500/15 blur-2xl pointer-events-none"
                aria-hidden="true"
              />
              <div
                className="absolute inset-0 opacity-[0.07] pointer-events-none"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
                  backgroundSize: '36px 36px',
                }}
                aria-hidden="true"
              />

              {/* Overlay Left Face (Visible during Sign Up mode -> invites back to Login) */}
              <div className="auth-overlay-copy-left absolute inset-y-0 left-0 w-1/2 flex flex-col justify-between p-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-indigo-200">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold tracking-tight text-white">
                    Pemetaan Jadual
                  </span>
                </div>

                <div className="my-auto space-y-4">
                  <h3 className="text-3xl font-extrabold tracking-tight leading-tight text-white text-balance">
                    Selamat Kembali Ke Portal Sekolah
                  </h3>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    Sudah mendaftarkan kod sekolah anda? Log masuk untuk menyambung pengurusan jadual, beban waktu guru, dan cetakan PDF.
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSignupErrorMsg('');
                        onModeChange('login');
                      }}
                      className="px-6 py-2.5 rounded-xl border border-white/30 bg-white/10 hover:bg-white hover:text-slate-900 text-white text-sm font-semibold inline-flex items-center gap-2 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    >
                      <LogIn className="w-4 h-4" aria-hidden="true" />
                      <span>Log Masuk</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>Matriks Pengajaran</span>
                  <span aria-hidden="true">·</span>
                  <span>Laporan Beban</span>
                  <span aria-hidden="true">·</span>
                  <span>Cetakan A4 PDF</span>
                </div>
              </div>

              {/* Overlay Right Face (Visible during Login mode -> invites to Sign Up) */}
              <div className="auth-overlay-copy-right absolute inset-y-0 right-0 w-1/2 flex flex-col justify-between p-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-indigo-200">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold tracking-tight text-white">
                    Pemetaan Jadual
                  </span>
                </div>

                <div className="my-auto space-y-4">
                  <h3 className="text-3xl font-extrabold tracking-tight leading-tight text-white text-balance">
                    Sekolah Baharu Di Portal Ini?
                  </h3>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    Daftarkan kod dan profil sekolah anda dalam beberapa saat untuk mengurus guru, kelas, mata pelajaran, serta eksport PDF A4 Landskap secara automatik.
                  </p>
                  <div className="pt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setLoginErrorMsg('');
                        onModeChange('signup');
                      }}
                      className="px-6 py-2.5 rounded-xl border border-white/30 bg-white/10 hover:bg-white hover:text-slate-900 text-white text-sm font-semibold inline-flex items-center gap-2 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    >
                      <UserPlus className="w-4 h-4" aria-hidden="true" />
                      <span>Daftar Sekolah</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>Pangkalan Data Awan</span>
                  <span aria-hidden="true">·</span>
                  <span>Auto-Simpan</span>
                  <span aria-hidden="true">·</span>
                  <span>Sedia Cetak</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* MOBILE ANIMATED TABBED VIEW */}
        <div className="md:hidden">
          <div className="bg-slate-900 px-6 pt-6 pb-5 text-white relative overflow-hidden">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'radial-gradient(circle at 85% 15%, rgba(99, 102, 241, 0.35), transparent 60%), linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
              }}
            />
            <div className="relative z-10 pr-10">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center text-indigo-200">
                  <Calendar className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold tracking-tight">Pemetaan Jadual</span>
              </div>

              {/* Segmented Switcher */}
              <div className="relative grid grid-cols-2 p-1 bg-white/10 rounded-xl border border-white/10">
                <div
                  className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-white shadow-sm transition-transform duration-300 ease-out"
                  style={{
                    transform: isSignUp ? 'translateX(100%)' : 'translateX(0%)',
                  }}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  onClick={() => onModeChange('login')}
                  className={`relative z-10 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                    !isSignUp ? 'text-slate-900' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Log Masuk
                </button>
                <button
                  type="button"
                  onClick={() => onModeChange('signup')}
                  className={`relative z-10 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                    isSignUp ? 'text-slate-900' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Daftar Baru
                </button>
              </div>
            </div>
          </div>

          <div key={mode} className="auth-mobile-panel-in max-h-[70vh] overflow-y-auto">
            {isSignUp ? renderSignUpForm(true) : renderLoginForm(true)}
          </div>
        </div>
      </div>

      {showQrPopup && (
        <div
          className="auth-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Kod QR DuitNow Buy Me a Coffee"
          onMouseDown={(e) => {
            e.stopPropagation();
            if (e.target === e.currentTarget) {
              setShowQrPopup(false);
            }
          }}
        >
          <div className="auth-modal-shell relative w-full max-w-[360px] bg-white rounded-2xl shadow-2xl overflow-hidden border border-white/20">
            <button
              type="button"
              onClick={() => setShowQrPopup(false)}
              aria-label="Tutup tetingkap Kod QR"
              className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/35 hover:bg-black/55 text-white flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src="/assets/aistudio/IMAGE_2026-11-26_20_31_43_8622c06c.jpg"
              alt="Kod QR DuitNow xKINGx"
              className="w-full h-auto max-h-[82vh] object-contain block"
            />
          </div>
        </div>
      )}
    </div>
  );
};

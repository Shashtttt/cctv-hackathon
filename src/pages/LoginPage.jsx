import React, { useState } from 'react';
import { 
  Shield, 
  ShieldCheck, 
  Lock, 
  User, 
  Mail, 
  KeyRound, 
  Eye, 
  EyeOff, 
  Zap, 
  Radio, 
  CheckCircle2, 
  AlertOctagon, 
  Award,
  ChevronRight,
  Activity
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './LoginPage.css';

const LoginPage = () => {
  const { login, register, demoLogin, loginWithGoogle, authError, setAuthError } = useAuth();
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form states
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('COMMANDER');
  const [clearanceLevel, setClearanceLevel] = useState('TOP_SECRET');
  const [department, setDepartment] = useState('Sector-4 Border Defense');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setAuthError(null);

    if (isRegisterMode) {
      if (!username || !password || !email) {
        setAuthError('Please fill in all mandatory security fields.');
        setIsSubmitting(false);
        return;
      }
      await register({
        username,
        password,
        email,
        full_name: fullName || 'Surveillance Officer',
        role,
        clearance_level: clearanceLevel,
        department,
        badge_number: `SEC-${Math.floor(1000 + Math.random() * 9000)}`,
      });
    } else {
      if (!username || !password) {
        setAuthError('Please enter your operator callsign and security key.');
        setIsSubmitting(false);
        return;
      }
      await login(username, password);
    }
    setIsSubmitting(false);
  };

  const handleDemo = async (demoRole) => {
    setIsSubmitting(true);
    await demoLogin(demoRole);
    setIsSubmitting(false);
  };

  const handleGoogleSignIn = async () => {
    setIsSubmitting(true);
    setAuthError(null);
    try {
      await loginWithGoogle();
    } catch (err) {
      setAuthError(err?.message || 'Google sign-in could not be completed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page-container">
      {/* Background Cyber Grid & Vignette */}
      <div className="login-bg-grid"></div>
      <div className="login-radar-glow"></div>

      {/* Center Auth Console */}
      <div className="login-auth-card">
        {/* Top Header & Tactical Badge */}
        <div className="auth-card-top">
          <div className="auth-badge-icon">
            <Shield className="shield-icon text-cyan" size={32} />
            <div className="badge-pulse-ring"></div>
          </div>
          
          <div className="auth-title-group">
            <div className="auth-pre-title font-mono">
              <Radio size={12} className="text-green pulse-dot" />
              <span>DEFENSE MATRIX • SECTOR 4 HIGH COMMAND</span>
            </div>
            <h1 className="auth-main-title">IBVAP SURVEILLANCE</h1>
            <p className="auth-subtitle">Intelligent Border Video Analytics & Biometric Platform</p>
          </div>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="auth-tab-row font-mono">
          <button 
            type="button"
            className={`auth-tab-btn ${!isRegisterMode ? 'active' : ''}`}
            onClick={() => { setIsRegisterMode(false); setAuthError(null); }}
          >
            <Lock size={13} />
            <span>OPERATOR SIGN IN</span>
          </button>

          <button 
            type="button"
            className={`auth-tab-btn ${isRegisterMode ? 'active' : ''}`}
            onClick={() => { setIsRegisterMode(true); setAuthError(null); }}
          >
            <User size={13} />
            <span>ENLIST / REGISTER</span>
          </button>
        </div>

        {/* Error Notification Alert */}
        {authError && (
          <div className="auth-error-banner font-mono">
            <AlertOctagon size={16} className="text-red" />
            <span>{authError}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="auth-form-fields">
          {/* Registration Extra Fields */}
          {isRegisterMode && (
            <>
              <div className="form-input-group">
                <label className="input-label font-mono">FULL NAME</label>
                <div className="input-field-wrapper">
                  <User size={15} className="field-icon text-sub" />
                  <input 
                    type="text" 
                    placeholder="e.g. Commander Sarah Vance"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="tactical-input"
                  />
                </div>
              </div>

              <div className="form-input-group">
                <label className="input-label font-mono">GOVERNMENT / MIL EMAIL *</label>
                <div className="input-field-wrapper">
                  <Mail size={15} className="field-icon text-sub" />
                  <input 
                    type="email" 
                    required
                    placeholder="officer@border.defense.gov"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="tactical-input"
                  />
                </div>
              </div>

              <div className="form-row-2col">
                <div className="form-input-group">
                  <label className="input-label font-mono">TACTICAL ROLE</label>
                  <select 
                    value={role} 
                    onChange={(e) => setRole(e.target.value)}
                    className="tactical-input select-tactical"
                  >
                    <option value="COMMANDER">Commander (Level 5)</option>
                    <option value="OPERATOR">Surveillance Officer (Level 3)</option>
                    <option value="ANALYST">Threat Analyst (Level 4)</option>
                    <option value="ADMIN">System Administrator</option>
                  </select>
                </div>

                <div className="form-input-group">
                  <label className="input-label font-mono">CLEARANCE LEVEL</label>
                  <select 
                    value={clearanceLevel} 
                    onChange={(e) => setClearanceLevel(e.target.value)}
                    className="tactical-input select-tactical"
                  >
                    <option value="TOP_SECRET">TOP SECRET (SCI)</option>
                    <option value="SECRET">SECRET</option>
                    <option value="CONFIDENTIAL">CONFIDENTIAL</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Username / Callsign */}
          <div className="form-input-group">
            <label className="input-label font-mono">OPERATOR CALLSIGN / USERNAME *</label>
            <div className="input-field-wrapper">
              <User size={15} className="field-icon text-cyan" />
              <input 
                type="text" 
                required
                placeholder="commander / operator / callsign"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="tactical-input font-mono"
                autoComplete="username"
              />
            </div>
          </div>

          {/* Security Key / Password */}
          <div className="form-input-group">
            <div className="label-row">
              <label className="input-label font-mono">SECURITY ACCESS PIN / PASSWORD *</label>
            </div>
            <div className="input-field-wrapper">
              <KeyRound size={15} className="field-icon text-cyan" />
              <input 
                type={showPassword ? 'text' : 'password'} 
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="tactical-input font-mono"
                autoComplete="current-password"
              />
              <button 
                type="button" 
                className="toggle-password-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Submit Action Button */}
          <button 
            type="submit" 
            disabled={isSubmitting}
            className="auth-submit-btn font-mono"
          >
            {isSubmitting ? (
              <span className="flex-center gap-2">
                <Activity size={16} className="spin-icon" />
                <span>AUTHENTICATING PROTOCOLS...</span>
              </span>
            ) : (
              <span className="flex-center gap-2">
                <span>{isRegisterMode ? 'ENLIST PERSONNEL & INITIATE SESSION' : 'ACCESS SURVEILLANCE CONSOLE'}</span>
                <ChevronRight size={16} />
              </span>
            )}
          </button>
        </form>

        {/* Firebase Google SSO Section */}
        <div className="firebase-auth-section">
          <div className="firebase-auth-divider font-mono">
            <span>OR CLOUD IDENTITY VERIFICATION</span>
          </div>
          <button
            type="button"
            className="firebase-google-btn font-mono"
            onClick={handleGoogleSignIn}
            disabled={isSubmitting}
          >
            <svg className="google-svg-icon" width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
              <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
            </svg>
            <span>SIGN IN WITH GOOGLE (FIREBASE SSO)</span>
          </button>
        </div>

        {/* Quick Demo Access Bar */}
        <div className="demo-access-strip">
          <div className="demo-strip-label font-mono">
            <Zap size={12} className="text-cyan" />
            <span>QUICK OPERATOR ACCESS (1-CLICK DEMO)</span>
          </div>

          <div className="demo-buttons-row">
            <button 
              type="button"
              onClick={() => handleDemo('ADMIN')}
              className="demo-btn demo-btn-admin font-mono"
              title="Access as Administrator (Full Snapshot Vault & Deletion Privileges)"
            >
              <Lock size={13} className="text-yellow" />
              <span>Admin Console</span>
            </button>

            <button 
              type="button"
              onClick={() => handleDemo('COMMANDER')}
              className="demo-btn demo-btn-commander font-mono"
              title="Access as Duty Commander (Level 5 Clearance)"
            >
              <Award size={13} className="text-cyan" />
              <span>Duty Commander</span>
            </button>

            <button 
              type="button"
              onClick={() => handleDemo('OPERATOR')}
              className="demo-btn demo-btn-operator font-mono"
              title="Access as Surveillance Officer (Level 3 Clearance)"
            >
              <ShieldCheck size={13} className="text-green" />
              <span>Surveillance Officer</span>
            </button>
          </div>
        </div>

        {/* Security Watermark Footer */}
        <div className="auth-card-footer font-mono">
          <span>SECURED BY 256-BIT ENCRYPTION</span>
          <span className="dot-sep">•</span>
          <span>AIR-GAPPED DEFENSE PROTOCOL</span>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

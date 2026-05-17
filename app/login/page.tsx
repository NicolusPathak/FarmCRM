// ============================================================
// app/login/page.tsx — Sign-in page for Chaudhary Farm
// ============================================================

import LoginForm from './LoginForm';

export const metadata = { title: 'Sign In — Chaudhary Farm' };

export default function LoginPage() {
  return <LoginForm />;
}

export const dynamic = 'force-dynamic';

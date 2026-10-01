import AuthForm from '@/components/auth/AuthForm';
export const metadata = { title: 'Log in | VisaFlow', robots: { index: false, follow: false } };
export default function LoginPage() { return <AuthForm mode="login" />; }

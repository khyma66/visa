import AuthForm from '@/components/auth/AuthForm';
export const metadata = { title: 'Sign up | VisaFlow', robots: { index: false, follow: false } };
export default function SignupPage() { return <AuthForm mode="signup" />; }

import AuthForm from '@/components/auth/AuthForm';
export const metadata = { title: 'Reset password | VisaFlow', robots: { index: false, follow: false } };
export default function ResetPasswordPage() { return <AuthForm mode="reset" />; }

import AdBanner from './ads/AdBanner';
import AdSidebar from './ads/AdSidebar';
import AdInFeed from './ads/AdInFeed';
import Link from 'next/link';
import AuthNav from './auth/AuthNav';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="relative z-50 flex items-center justify-between border-b bg-white px-6 py-4">
        <Link href="/" className="text-xl font-bold text-gray-900">VisaFlow</Link>
        <AuthNav />
      </header>
      <AdSidebar slotId="left-sidebar-home" position="left" />
      <AdSidebar slotId="right-sidebar-home" position="right" />

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <AdBanner slotId="top-banner-home" format="horizontal" className="w-full" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-8">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Visa Information</h2>
              <p className="text-gray-600 mb-4">Your comprehensive resource for visa applications and requirements.</p>
              <div className="ad-placeholder h-[250px] flex items-center justify-center">Ad Space</div>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Popular Countries</h2>
              <ul className="space-y-2 text-gray-600">
                <li>USA Visa Information</li>
                <li>UK Visa Information</li>
                <li>Canada Visa Information</li>
                <li>Australia Visa Information</li>
              </ul>
            </div>
          </div>

          <div className="lg:col-span-1 space-y-8">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Community Discussions</h2>
              <p className="text-gray-600 mb-4">Join thousands of users sharing their visa experiences and tips.</p>
            </div>

            <AdInFeed slotId="infeed-home-1" className="w-full" />

            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Latest Updates</h2>
              <AdInFeed slotId="infeed-home-2" className="w-full" />
            </div>
          </div>

          <div className="lg:col-span-1 space-y-8">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Featured Posts</h2>
              <div className="ad-placeholder h-[300px] flex items-center justify-center">Ad Space</div>
            </div>

            <AdInFeed slotId="infeed-home-3" className="w-full" />

            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Newsletter</h2>
              <div className="ad-placeholder h-[250px] flex items-center justify-center">Ad Space</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

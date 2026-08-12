import dynamic from 'next/dynamic';
import Navbar from '../components/Navbar/Navbar';
import Hero from '../components/Landing/Hero';
import Footer from '../components/Footer/Footer';

// Code splitting: lazy-load below-the-fold landing sections to reduce
// initial JS bundle. Hero stays eager for fast LCP.
const Features = dynamic(() => import('../components/Landing/Features'));
const Benefits = dynamic(() => import('../components/Landing/Benefits'));
const Stats = dynamic(() => import('../components/Landing/Stats'));
const Testimonials = dynamic(() => import('../components/Landing/Testimonials'));
const CTA = dynamic(() => import('../components/Landing/CTA'));

/**
 * Public Landing page. Server Component - it composes the marketing
 * sections (each a Client Component because they use framer-motion's
 * whileInView / animate). SSR ships the static markup immediately; the
 * motion animations hydrate on the client.
 */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar tone="light" />
      <div id="main-content">
      <Hero />
      <Features />
      <Benefits />
      <Stats />
      <Testimonials />
      <CTA />
      </div>
      <Footer />
    </div>
  );
}

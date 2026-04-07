import { PublicHeader } from '@/components/layout/PublicHeader';
import { Button } from '@/components/ui/button';
import { ChevronRight, Shield, Clock, MousePointer2, CheckCircle2, Scale } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ROUTES, FIRM_DEFAULTS } from '@/config/constants';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <PublicHeader />

      <main>
        {/* Hero Section */}
        <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
          {/* Subtle background decoration */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full -z-10 opacity-30 pointer-events-none">
            <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-blue-50 rounded-full blur-3xl" />
            <div className="absolute bottom-[10%] left-[-5%] w-[400px] h-[400px] bg-indigo-50 rounded-full blur-3xl" />
          </div>

          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#1a365d]/5 text-[#1a365d] text-xs font-bold uppercase tracking-wider mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <span className="flex h-2 w-2 rounded-full bg-[#1a365d] animate-pulse" />
              Serving New Jersey Families
            </div>
            
            <h1 className="text-5xl md:text-7xl font-black text-[#1a365d] tracking-tight mb-8 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150">
              Modern Estate Planning <br className="hidden md:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#1a365d] to-[#2b6cb0]">
                Made Simple.
              </span>
            </h1>

            <p className="max-w-2xl mx-auto text-lg md:text-xl text-gray-600 mb-10 leading-relaxed animate-in fade-in slide-in-from-bottom-8 duration-700 delay-300">
              Protect your legacy and your loved ones with attorney-drafted 
              estate documents, powered by intelligent automation.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-500">
              <Button 
                asChild
                size="lg"
                className="h-14 px-10 rounded-full bg-[#1a365d] hover:bg-[#1e407a] text-lg font-bold shadow-2xl hover:scale-105 transition-all"
              >
                <Link to={ROUTES.LOGIN}>Get Started Now</Link>
              </Button>
              <Button 
                asChild
                variant="outline"
                size="lg"
                className="h-14 px-10 rounded-full border-gray-200 text-gray-700 text-lg font-semibold hover:bg-gray-50 transition-all"
              >
                <Link to="/assessment" className="flex items-center gap-2">
                  Free Assessment
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>

            {/* Trust Badges */}
            <div className="mt-20 flex flex-wrap justify-center items-center gap-8 md:gap-16 opacity-50 grayscale hover:grayscale-0 transition-all duration-500 delay-700 animate-in fade-in">
                <div className="flex items-center gap-2 font-bold text-gray-900">
                    <Shield className="h-5 w-5" />
                    Secure & Encrypted
                </div>
                <div className="flex items-center gap-2 font-bold text-gray-900">
                    <CheckCircle2 className="h-5 w-5" />
                    NJ Licensed Attorney
                </div>
                <div className="flex items-center gap-2 font-bold text-gray-900">
                    <Clock className="h-5 w-5" />
                    Completed in Minutes
                </div>
            </div>
          </div>
        </section>

        {/* Features Preview (placeholder for 'Tools') */}
        <section className="py-24 bg-gray-50">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-bold text-[#1a365d] mb-4">Complete Your Plan in 3 Steps</h2>
                    <p className="text-gray-500 max-w-xl mx-auto">Our streamlined process makes it easy to protect your future without the stress of traditional law firms.</p>
                </div>
                
                <div className="grid md:grid-cols-3 gap-8">
                    {[
                        {
                            title: 'Quick Assessment',
                            desc: 'Answer a few simple questions to determine which package fits your needs.',
                            icon: <MousePointer2 className="h-8 w-8 text-blue-500" />
                        },
                        {
                            title: 'Intelligent Intake',
                            desc: "Fill out our secure questionnaire at your own pace. We'll guide you through every decision.",
                            icon: <Shield className="h-8 w-8 text-indigo-500" />
                        },
                        {
                            title: 'Attorney Review',
                            desc: 'An attorney reviews your data and finalize your documents for signature.',
                            icon: <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                        }
                    ].map((step, i) => (
                        <div key={i} className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 hover:shadow-xl transition-shadow group">
                            <div className="mb-6 p-3 bg-gray-50 rounded-2xl w-fit group-hover:bg-blue-50 transition-colors">
                                {step.icon}
                            </div>
                            <h3 className="text-xl font-bold text-[#1a365d] mb-3">{step.title}</h3>
                            <p className="text-sm text-gray-600 leading-relaxed">{step.desc}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
      </main>

      {/* Basic Footer */}
      <footer className="bg-white border-t border-gray-100 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-3">
              <Scale className="h-6 w-6 text-[#1a365d]" />
              <span className="font-bold text-[#1a365d]">{FIRM_DEFAULTS.firmName}</span>
            </div>
            <div className="flex gap-8 text-sm text-gray-500">
              <Link to="/terms" className="hover:text-[#1a365d]">Terms</Link>
              <Link to="/privacy" className="hover:text-[#1a365d]">Privacy</Link>
              <Link to="/contact" className="hover:text-[#1a365d]">Contact</Link>
            </div>
            <p className="text-xs text-gray-400">
              &copy; {new Date().getFullYear()} {FIRM_DEFAULTS.firmName}. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

import React from 'react';
import { Link } from 'react-router-dom';
import { Zap, Shield, Gauge, Gamepad2, Monitor, Brain, BarChart3, Code, Cpu } from 'lucide-react';
import PageBackground from './PageBackground';
import SectionHeading from './SectionHeading';
import Reveal from './Reveal';

const features = [
  {
    icon: <Gamepad2 className="w-6 h-6 text-red-500" />,
    title: "Built for Gaming Businesses",
    subtitle: "Not Just Software",
    description: "We build high-performance gaming cafe management platforms designed for how you actually operate.",
    list: ["Game time tracking", "Automated billing", "Tournament management", "PC control & monitoring"]
  },
  {
    icon: <Monitor className="w-6 h-6 text-red-400" />,
    title: "Complete Internet Cafe Management",
    subtitle: "All-in-One Dashboard",
    description: "From small browsing centers to large cyber hubs. Everything you need to run efficiently.",
    list: ["User login control", "Time-based billing", "Bandwidth monitoring", "Security & activity tracking"]
  },
  {
    icon: <Brain className="w-6 h-6 text-red-500" />,
    title: "AI-Powered Smart Solutions",
    subtitle: "Intelligent Operations",
    description: "Integrate Artificial Intelligence to give your business an edge. Your cafe becomes intelligent.",
    list: ["Smart usage prediction", "Revenue forecasting", "Security anomaly detection", "Customer behavior analysis"]
  },
  {
    icon: <Gauge className="w-6 h-6 text-red-400" />,
    title: "High Performance Architecture",
    subtitle: "Scalable & Modern",
    description: "Built with modern technologies. Whether you run 10 systems or 1000 — we grow with you.",
    list: ["React-based dashboards", "Cloud-ready backend", "Real-time monitoring", "Scalable database"]
  },
  {
    icon: <Shield className="w-6 h-6 text-red-500" />,
    title: "Security First Approach",
    subtitle: "Protected Data",
    description: "Your systems and customer data are protected with enterprise-grade protocols.",
    list: ["Encrypted communication", "Role-based admin access", "Secure authentication", "Backup & recovery"]
  },
  {
    icon: <BarChart3 className="w-6 h-6 text-red-400" />,
    title: "Data-Driven Decisions",
    subtitle: "No Guesswork",
    description: "Make smarter business decisions with real-time insights and comprehensive reporting.",
    list: ["Revenue dashboards", "Peak hour analysis", "Usage heatmaps", "AI-based insights"]
  }
];

const WhyUsPage = () => {
  return (
    <section className="section-seam relative bg-black overflow-hidden antialiased font-sans text-white">

      <PageBackground streakTop="top-1/4" streakBottom="bottom-1/3" />

      {/* --- Main Content --- */}
      <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-6 section-y">

        <SectionHeading
          eyebrow="Technology Ecosystem"
          title="WHY"
          highlight="CHOOSE US?"
          description="We don’t just sell software. We build technology ecosystems."
          className="mb-12 sm:mb-14"
        />

        {/* Feature Grid - Glassmorphism Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12 sm:mb-14">
          {features.map((feature, index) => (
            <Reveal key={feature.title} delay={(index % 3) * 90} className="h-full">
              <article
                className="group relative bg-white/[0.02] border border-white/10 rounded-xl p-6 backdrop-blur-sm
                           transition-all duration-300 hover:bg-white/[0.05] hover:border-red-500/30
                           hover:-translate-y-1 motion-reduce:hover:translate-y-0
                           flex flex-col h-full shadow-[0_0_30px_-10px_rgba(0,0,0,0.5)]"
              >
                {/* Status Badge */}
                <div className="flex items-center justify-between mb-5">
                  <div className="p-2 rounded-lg border border-white/10 bg-white/5 transition-colors group-hover:border-red-500/30 group-hover:bg-red-500/10">
                    {feature.icon}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-neutral-500 uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_5px_rgba(220,38,38,0.5)]"></span>
                    Active
                  </div>
                </div>

                <div className="mb-4">
                  <span className="text-xs font-mono text-red-500/70 tracking-wider">{feature.subtitle}</span>
                  <h3 className="text-lg font-semibold text-white mt-1">{feature.title}</h3>
                </div>

                <p className="text-neutral-400 text-sm mb-4 leading-relaxed grow">
                  {feature.description}
                </p>

                {/* Feature List */}
                <ul className="space-y-2.5 pt-4 border-t border-white/5">
                  {feature.list.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-xs text-neutral-300 font-mono">
                      <Zap className="w-3 h-3 text-red-500 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>

                {/* Decorative Corner */}
                <div className="absolute bottom-0 right-0 w-8 h-8 border-r border-b border-white/0 group-hover:border-red-500/20 transition-colors rounded-br-xl" />
              </article>
            </Reveal>
          ))}
        </div>

        {/* Custom Development Section (Wide Card) */}
        <Reveal>
          <div className="bg-neutral-900/50 border border-white/10 rounded-xl backdrop-blur-md font-mono text-xs relative overflow-hidden shadow-[0_0_50px_-20px_rgba(220,38,38,0.1)]">
            {/* Window Controls */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/[0.02]">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
              </div>
              <span className="text-neutral-600 text-xs truncate px-2">custom_solutions.exe</span>
              <div className="flex items-center gap-2 text-neutral-600 shrink-0">
                <Cpu className="w-3 h-3" />
                <span className="hidden sm:inline">Optimized</span>
              </div>
            </div>

            <div className="p-6 sm:p-8 md:p-10 flex flex-col md:flex-row gap-8 items-center">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-4">
                  <Code className="w-6 h-6 text-red-500 shrink-0" />
                  <h3 className="text-base sm:text-lg font-semibold text-white tracking-wide">Custom Development &amp; AI Integration</h3>
                </div>
                <p className="text-neutral-400 leading-relaxed mb-6">
                  Need something unique? We provide custom gaming cafe solutions, AI model integration, automation tools, and full-stack development support.
                </p>
                <div className="flex flex-wrap gap-2">
                  {['Web Development', 'Android & iOS Apps', 'Automation Tools', 'AI Models', 'Business Digitization'].map((tag) => (
                    <span key={tag} className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-full text-[10px] text-red-400">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <Link
                to="/contact"
                className="group relative flex items-center justify-center gap-3 px-8 py-3.5
                           w-full md:w-auto shrink-0
                           text-sm font-semibold rounded-full text-white transition-all duration-300
                           bg-gradient-to-br from-red-700 to-red-900
                           border border-white/10
                           hover:scale-[1.02] active:scale-[0.98] motion-reduce:hover:scale-100
                           hover:shadow-[0_0_28px_-5px_rgba(220,38,38,0.55)]
                           shadow-[0_0_20px_-5px_rgba(220,38,38,0.3)]"
              >
                <Zap className="w-4 h-4" />
                Request Custom Build
              </Link>
            </div>
          </div>
        </Reveal>

      </div>
    </section>
  );
};

export default WhyUsPage;

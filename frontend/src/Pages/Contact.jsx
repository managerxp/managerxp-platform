import React, { useRef, useState } from 'react';
import { MapPin, Mail, Phone, Send, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import emailjs from '@emailjs/browser';
import PageBackground from '../components/PageBackground';
import SectionHeading from '../components/SectionHeading';
import Reveal from '../components/Reveal';

const fieldClasses =
  'w-full bg-white/[0.03] border border-white/10 text-white px-4 py-3 rounded-lg ' +
  'focus:outline-none focus:border-red-500/60 focus:ring-2 focus:ring-red-500/20 focus:bg-white/[0.05] ' +
  'transition-colors placeholder-neutral-700 text-sm';

const labelClasses = 'block text-neutral-500 mb-2 text-xs uppercase tracking-wider';

const contactCards = [
  {
    icon: <MapPin className="w-6 h-6" />,
    title: 'Location',
    body: (
      <>
        8-2-644/1/205 F205, Hiline Complex, <br />
        Road No.12, Banjara Hills,<br />
        Hyderabad- 500034
      </>
    )
  },
  {
    icon: <Mail className="w-6 h-6" />,
    title: 'Email',
    body: 'managerxp2026@gmail.com',
    note: 'Response time: ~24h'
  },
  {
    icon: <Phone className="w-6 h-6" />,
    title: 'Phone',
    body: '+91 9679549136',
    note: 'Mon-Fri: 9AM - 6PM'
  }
];

const ContactPage = () => {
  const formRef = useRef(null);

  // Form State
  const [status, setStatus] = useState({ type: '', message: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sendEmail = (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setStatus({ type: '', message: '' });

    // REPLACE THESE WITH YOUR ACTUAL EMAILJS IDs
    const serviceID = 'YOUR_SERVICE_ID';
    const templateID = 'YOUR_TEMPLATE_ID';
    const publicKey = 'YOUR_PUBLIC_KEY';

    emailjs.sendForm(serviceID, templateID, formRef.current, publicKey)
      .then((result) => {
          console.log(result.text);
          setStatus({ type: 'success', message: 'Message transmitted successfully!' });
          formRef.current.reset();
      }, (error) => {
          console.log(error.text);
          setStatus({ type: 'error', message: 'Transmission failed. Please try again.' });
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  return (
    <div className="relative min-h-screen bg-black overflow-hidden antialiased font-sans text-white">

      <PageBackground streakTop="top-1/3" streakBottom="bottom-1/4" />

      {/* --- Main Content --- */}
      <div className="relative z-10 max-w-6xl mx-auto px-5 sm:px-6 section-y">

        <SectionHeading
          as="h1"
          eyebrow="Communication Channel"
          title="CONTACT"
          highlight="US"
          description="Have a project in mind or need support? Initialize a connection."
          className="mb-14 sm:mb-12 sm:mb-14"
        />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8">

          {/* Left: Contact Info Cards */}
          <div className="lg:col-span-2 space-y-6">
            {contactCards.map((card, index) => (
              <Reveal key={card.title} delay={index * 90}>
                <div className="bg-white/[0.02] border border-white/10 rounded-xl p-6 backdrop-blur-sm hover:border-red-500/30 transition-all group">
                  <div className="flex items-start gap-4">
                    <div className="p-3 border border-white/10 bg-white/5 rounded-lg text-red-500 shrink-0 group-hover:border-red-500/30 group-hover:bg-red-500/10 transition-all">
                      {card.icon}
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-white font-semibold mb-1">{card.title}</h2>
                      <p className="text-neutral-400 text-sm leading-relaxed break-words">
                        {card.body}
                      </p>
                      {card.note && (
                        <p className="text-neutral-600 text-xs mt-1 font-mono">{card.note}</p>
                      )}
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}

            {/* Decorative Terminal Element */}
            <Reveal delay={270}>
              <div className="hidden lg:block bg-neutral-900 border border-white/10 rounded-xl p-1 font-mono text-xs shadow-xl">
                <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5 bg-white/[0.02]">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <div className="w-2 h-2 rounded-full bg-yellow-500" />
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                </div>
                <div className="p-3 text-neutral-400">
                  <span className="text-red-500">$</span> ping support.managerxp.com <br />
                  <span className="text-green-500">status:</span> online <br />
                  <span className="text-green-500">latency:</span> 12ms
                </div>
              </div>
            </Reveal>
          </div>

          {/* Right: Contact Form */}
          <Reveal delay={120} direction="right" className="lg:col-span-3">
            <div className="bg-white/[0.02] border border-white/10 rounded-xl backdrop-blur-md font-mono text-xs relative overflow-hidden shadow-[0_0_50px_-20px_rgba(220,38,38,0.1)] h-full">

              {/* Window Controls */}
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                <div className="flex gap-1.5 shrink-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                </div>
                <span className="text-neutral-600 text-xs truncate">new_message.config</span>
                <div className="text-neutral-500 text-xs shrink-0">SECURE</div>
              </div>

              <form ref={formRef} onSubmit={sendEmail} className="p-5 sm:p-6 md:p-8 space-y-6 relative z-10">

                {/* Status Notification */}
                <div aria-live="polite">
                  {status.message && (
                    <div
                      className={`flex items-center gap-2 p-3 rounded-lg text-sm font-mono ${
                        status.type === 'success'
                          ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                          : 'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}
                    >
                      {status.type === 'success'
                        ? <CheckCircle className="w-4 h-4 shrink-0" />
                        : <AlertCircle className="w-4 h-4 shrink-0" />}
                      {status.message}
                    </div>
                  )}
                </div>

                {/* Grid for Name & Email */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
                  <div>
                    <label htmlFor="user_name" className={labelClasses}>User Name</label>
                    <input
                      id="user_name"
                      type="text"
                      name="user_name"
                      required
                      autoComplete="name"
                      className={fieldClasses}
                      placeholder="Enter name..."
                    />
                  </div>
                  <div>
                    <label htmlFor="user_email" className={labelClasses}>User Email</label>
                    <input
                      id="user_email"
                      type="email"
                      name="user_email"
                      required
                      autoComplete="email"
                      className={fieldClasses}
                      placeholder="Enter email..."
                    />
                  </div>
                </div>

                {/* Subject */}
                <div>
                  <label htmlFor="subject" className={labelClasses}>Subject</label>
                  <input
                    id="subject"
                    type="text"
                    name="subject"
                    required
                    className={fieldClasses}
                    placeholder="Topic of transmission..."
                  />
                </div>

                {/* Message */}
                <div>
                  <label htmlFor="message" className={labelClasses}>Message</label>
                  <textarea
                    id="message"
                    name="message"
                    rows="5"
                    required
                    className={`${fieldClasses} resize-y min-h-32`}
                    placeholder="Type your message here..."
                  />
                </div>

                {/* Submit Button */}
                <div className="pt-2 sm:pt-4">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="group relative flex items-center justify-center gap-3 w-full px-8 py-3.5
                             text-sm font-semibold rounded-full text-white
                             transition-all duration-300
                             bg-gradient-to-br from-red-700 to-red-900
                             border border-white/10
                             hover:scale-[1.01] active:scale-[0.98] motion-reduce:hover:scale-100
                             hover:shadow-[0_0_28px_-5px_rgba(220,38,38,0.55)]
                             shadow-[0_0_25px_-5px_rgba(220,38,38,0.4)]
                             disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 overflow-hidden"
                  >
                    {/* Shine Animation */}
                    <div aria-hidden="true" className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-12" />

                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin relative z-10" />
                        <span className="relative z-10">TRANSMITTING...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 relative z-10" />
                        <span className="relative z-10">SEND MESSAGE</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
};

export default ContactPage;

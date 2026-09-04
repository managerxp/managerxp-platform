import React, { useRef, useState } from 'react';
import { Calendar, User, Building2, Mail, Phone, Gamepad2, Monitor, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import emailjs from '@emailjs/browser';
import PageBackground from '../components/PageBackground';
import SectionHeading from '../components/SectionHeading';
import Reveal from '../components/Reveal';

const fieldClasses =
  'w-full bg-white/[0.03] border border-white/10 text-white px-4 py-3 rounded-lg ' +
  'focus:outline-none focus:border-red-500/60 focus:ring-2 focus:ring-red-500/20 focus:bg-white/[0.05] ' +
  'transition-colors placeholder-neutral-700 text-sm';

const labelClasses = 'flex items-center gap-2 text-neutral-500 mb-2 text-xs uppercase tracking-wider';

const softwareOptions = [
  {
    value: 'GamingXP',
    label: 'GamingXP',
    description: 'Gaming Café Solution',
    icon: <Gamepad2 className="w-5 h-5 text-red-500" />
  },
  {
    value: 'CafeXP',
    label: 'CafeXP',
    description: 'Internet Café Solution',
    icon: <Monitor className="w-5 h-5 text-red-400" />
  }
];

const BookDemoPage = () => {
  const formRef = useRef(null);

  // State for form submission
  const [status, setStatus] = useState({ type: '', message: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedSoftware, setSelectedSoftware] = useState('');

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
          setStatus({ type: 'success', message: 'Demo request transmitted successfully!' });
          formRef.current.reset();
          setSelectedSoftware('');
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
      <div className="relative z-10 max-w-4xl mx-auto px-5 sm:px-6 section-y">

        <SectionHeading
          as="h1"
          eyebrow="Initialize Session"
          title="BOOK A"
          highlight="DEMO"
          description="Schedule a live demonstration of our ecosystem."
          className="mb-12"
        />

        {/* Form Container */}
        <Reveal className="block">
          <div className="relative">
            {/* Decorative background glow */}
            <div aria-hidden="true" className="absolute -inset-1 bg-gradient-to-r from-red-500/20 to-black rounded-xl blur-xl opacity-30" />

            <div className="relative bg-white/[0.02] border border-white/10 rounded-xl backdrop-blur-md font-mono text-xs overflow-hidden shadow-[0_0_50px_-20px_rgba(220,38,38,0.1)]">

              {/* Window Controls */}
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                <div className="flex gap-1.5 shrink-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                </div>
                <span className="text-neutral-600 text-xs truncate">demo_protocol.exe</span>
                <div className="text-neutral-500 text-xs shrink-0">ACTIVE</div>
              </div>

              <form ref={formRef} onSubmit={sendEmail} className="p-5 sm:p-6 md:p-10 space-y-7 sm:space-y-8 relative z-10">

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

                {/* Row 1: Name & Organization */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
                  <div>
                    <label htmlFor="user_name" className={labelClasses}>
                      <User className="w-3 h-3" /> Your Name
                    </label>
                    <input
                      id="user_name"
                      type="text"
                      name="user_name"
                      required
                      autoComplete="name"
                      className={fieldClasses}
                      placeholder="John Doe"
                    />
                  </div>
                  <div>
                    <label htmlFor="organization_name" className={labelClasses}>
                      <Building2 className="w-3 h-3" /> Organization
                    </label>
                    <input
                      id="organization_name"
                      type="text"
                      name="organization_name"
                      required
                      autoComplete="organization"
                      className={fieldClasses}
                      placeholder="Cafe Name / Company"
                    />
                  </div>
                </div>

                {/* Row 2: Email & Phone */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
                  <div>
                    <label htmlFor="user_email" className={labelClasses}>
                      <Mail className="w-3 h-3" /> Email Address
                    </label>
                    <input
                      id="user_email"
                      type="email"
                      name="user_email"
                      required
                      autoComplete="email"
                      className={fieldClasses}
                      placeholder="you@company.com"
                    />
                  </div>
                  <div>
                    <label htmlFor="phone_number" className={labelClasses}>
                      <Phone className="w-3 h-3" /> Phone Number
                    </label>
                    <input
                      id="phone_number"
                      type="tel"
                      name="phone_number"
                      required
                      autoComplete="tel"
                      className={fieldClasses}
                      placeholder="+1 (555) 123-4567"
                    />
                  </div>
                </div>

                {/* Row 3: Software Selection */}
                <fieldset>
                  <legend className="text-neutral-500 mb-3 text-xs uppercase tracking-wider">
                    Select Software
                  </legend>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {softwareOptions.map((option) => {
                      const isSelected = selectedSoftware === option.value;
                      return (
                        <label
                          key={option.value}
                          className={`relative flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-all
                                      focus-within:ring-2 focus-within:ring-red-500/40
                                      ${isSelected
                                        ? 'border-red-500/50 bg-red-500/10'
                                        : 'border-white/10 bg-white/[0.02] hover:border-white/20'}`}
                        >
                          <input
                            type="radio"
                            name="software_type"
                            value={option.value}
                            className="sr-only"
                            checked={isSelected}
                            onChange={(e) => setSelectedSoftware(e.target.value)}
                            required
                          />
                          <div className={`p-2 rounded-lg border transition-colors shrink-0 ${
                            isSelected ? 'bg-red-500/20 border-red-500/30' : 'bg-white/5 border-white/10'
                          }`}>
                            {option.icon}
                          </div>
                          <div className="min-w-0">
                            <span className="text-white font-medium text-sm block">{option.label}</span>
                            <span className="text-neutral-500 text-xs">{option.description}</span>
                          </div>
                          {isSelected && (
                            <div className="absolute right-4 top-4 w-2 h-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(220,38,38,0.5)]" />
                          )}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {/* Row 4: Subject */}
                <div>
                  <label htmlFor="subject" className={labelClasses}>Subject</label>
                  <input
                    id="subject"
                    type="text"
                    name="subject"
                    required
                    className={fieldClasses}
                    placeholder="How can we help you?"
                  />
                </div>

                {/* Row 5: Message */}
                <div>
                  <label htmlFor="message" className={labelClasses}>Message</label>
                  <textarea
                    id="message"
                    name="message"
                    rows="4"
                    required
                    className={`${fieldClasses} resize-y min-h-28`}
                    placeholder="Tell us about your project or requirements..."
                  />
                </div>

                {/* Submit Button */}
                <div className="pt-2 sm:pt-4">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="group relative flex items-center justify-center gap-3 w-full px-8 py-4
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
                        <Calendar className="w-5 h-5 relative z-10" />
                        <span className="relative z-10">SCHEDULE DEMO</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
};

export default BookDemoPage;

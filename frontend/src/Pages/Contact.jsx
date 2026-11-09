import React, { useRef, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { sendContactForm } from '../lib/contactEmail';
import { fieldClass, labelClass } from '../lib/formStyles';
import Seo from '../components/site/Seo';
import SectionHeading from '../components/SectionHeading';
import FormStatus from '../components/site/FormStatus';

const ContactPage = () => {
  const formRef = useRef(null);
  const [status, setStatus] = useState({ type: '', message: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sendEmail = (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setStatus({ type: '', message: '' });

    sendContactForm(formRef.current)
      .then(
        () => {
          setStatus({ type: 'success', message: 'Message sent. We will reply to your email, usually within a day.' });
          formRef.current.reset();
        },
        (error) => {
          setStatus({
            type: error.status === 503 ? 'warn' : 'error',
            message: error.message || 'Your message could not be sent. Please try again, or email managerxp2026@gmail.com directly.',
          });
        }
      )
      .finally(() => setIsSubmitting(false));
  };

  return (
    <div className="bg-sheet font-display text-carbon antialiased">
      <Seo
        title="Contact ManagerXP | Start a Conversation"
        description="Tell ManagerXP about your project, product question or partnership. Email managerxp2026@gmail.com or call +91 96795 49136. Banjara Hills, Hyderabad."
        path="/contact"
      />

      <div className="wrap pb-20 pt-12 sm:pb-28 sm:pt-16">
        <SectionHeading
          as="h1"
          title="Let's build together"
          description="Describe the problem you want solved, the product you are curious about, or the partnership you have in mind. A person from the team reads every message."
        />

        <div className="mt-14 grid gap-14 border-t border-carbon pt-12 lg:grid-cols-12 lg:gap-12">
          <aside className="space-y-10 lg:col-span-4">
            <div>
              <h2 className="text-[15px] text-graphite">Email</h2>
              <a href="mailto:managerxp2026@gmail.com" className="mt-2 block break-all text-[26px] font-bold tracking-[-0.02em] hover:text-signal">
                managerxp2026@gmail.com
              </a>
              <p className="mt-1 text-[15px] text-graphite">Replies usually within 24 hours.</p>
            </div>
            <div>
              <h2 className="text-[15px] text-graphite">Phone</h2>
              <a href="tel:+919679549136" className="mt-2 block text-[26px] font-bold tracking-[-0.02em] hover:text-signal">
                +91 96795 49136
              </a>
              <p className="mt-1 text-[15px] text-graphite">Monday to Friday, 9 AM to 6 PM IST.</p>
            </div>
            <div>
              <h2 className="text-[15px] text-graphite">Office</h2>
              <address className="mt-2 text-lg not-italic leading-snug">
                8-2-644/1/205 F205, Hiline Complex,<br />
                Road No. 12, Banjara Hills,<br />
                Hyderabad 500034, India
              </address>
            </div>
          </aside>

          <form ref={formRef} onSubmit={sendEmail} className="space-y-6 lg:col-span-8">
            <FormStatus status={status} />

            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <label htmlFor="user_name" className={labelClass}>Name</label>
                <input id="user_name" type="text" name="user_name" required autoComplete="name" className={fieldClass} />
              </div>
              <div>
                <label htmlFor="user_email" className={labelClass}>Work email</label>
                <input id="user_email" type="email" name="user_email" required autoComplete="email" className={fieldClass} />
              </div>
            </div>

            <div>
              <label htmlFor="subject" className={labelClass}>Subject</label>
              <input
                id="subject"
                type="text"
                name="subject"
                required
                className={fieldClass}
                placeholder="Custom project, CafeXP, RaceXP, FlowXP, partnership…"
              />
            </div>

            <div>
              <label htmlFor="message" className={labelClass}>What are you trying to solve?</label>
              <textarea
                id="message"
                name="message"
                rows="6"
                required
                className={`${fieldClass} min-h-40 resize-y`}
                placeholder="A few lines on your business, the workflow involved, and what a good outcome looks like."
              />
            </div>

            <button type="submit" disabled={isSubmitting} className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-[14rem]">
              {isSubmitting ? (
                <>
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  Send message
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ContactPage;

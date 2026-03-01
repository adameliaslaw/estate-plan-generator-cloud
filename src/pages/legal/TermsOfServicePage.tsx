/**
 * TermsOfServicePage.tsx
 *
 * Static Terms of Service page for the Elias Counsel, LLC client portal.
 * Print-friendly layout with numbered sections.
 */

import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function TermsOfServicePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white">
      {/* Screen-only header */}
      <div className="print:hidden border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="gap-2 text-[#1a365d] hover:text-[#1a365d] hover:bg-[#ebf4ff]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="gap-2 text-[#1a365d] border-[#1a365d]/30 hover:bg-[#ebf4ff]"
          >
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      </div>

      {/* Document body */}
      <main className="mx-auto max-w-4xl px-6 py-10 print:px-12 print:py-8">
        {/* Firm header */}
        <header className="mb-8 text-center print:mb-6">
          <h1 className="text-2xl font-bold text-[#1a365d] print:text-xl">
            Elias Counsel, LLC
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            168 Prospect Plains Road, Monroe Township, NJ 08831
          </p>
          <p className="mt-1 text-sm text-gray-500">
            (609) 655-3200 &bull; info@adameliaslaw.com
          </p>
          <div className="mt-4 border-t border-b border-[#1a365d]/20 py-3">
            <h2 className="text-xl font-semibold text-[#1a365d] print:text-lg">
              Terms of Service — Client Portal
            </h2>
            <p className="mt-1 text-xs text-gray-400">Last updated: February 2026</p>
          </div>
        </header>

        {/* Intro */}
        <p className="mb-6 text-sm leading-relaxed text-gray-700">
          Please read these Terms of Service ("Terms") carefully before using the Elias Counsel,
          LLC Client Portal ("Platform"). By accessing or using this Platform, you agree to be bound
          by these Terms. If you do not agree to these Terms, do not use this Platform.
        </p>

        <div className="space-y-8 text-sm leading-relaxed text-gray-700">
          {/* Section 1 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              1. Acceptance of Terms
            </h3>
            <p>
              By creating an account and accessing the Platform, you confirm that you are at least
              18 years of age, have the legal capacity to enter into binding agreements, and accept
              these Terms in full. These Terms constitute a legally binding agreement between you
              ("User," "Client," or "you") and Elias Counsel, LLC ("Firm," "we," "our," or "us").
            </p>
            <p className="mt-2">
              We reserve the right to update these Terms at any time. Continued use of the Platform
              after any such changes constitutes your acceptance of the revised Terms. We will
              notify you of material changes via email or a notice on the Platform.
            </p>
          </section>

          {/* Section 2 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              2. Description of Service
            </h3>
            <p>
              The Platform is a secure, cloud-based portal that enables clients of Elias Counsel,
              LLC to submit estate planning intake information, communicate with the Firm, review
              draft estate planning documents, and access completed legal documents prepared by the
              Firm. The Platform is provided solely in connection with the Firm's legal
              representation of its clients.
            </p>
            <p className="mt-2">
              The Platform facilitates the preparation of New Jersey estate planning documents
              including, but not limited to, Wills, Trusts, Powers of Attorney, and Advance
              Directives for Health Care. All documents prepared through this Platform are reviewed
              and executed under the supervision of a licensed New Jersey attorney.
            </p>
          </section>

          {/* Section 3 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              3. User Accounts
            </h3>
            <p>
              Access to the Platform requires a unique username and password. You are responsible
              for maintaining the confidentiality of your account credentials and for all activities
              that occur under your account. You agree to:
            </p>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>Provide accurate, current, and complete information when creating your account;</li>
              <li>Notify the Firm immediately of any unauthorized use of your account;</li>
              <li>Not share your login credentials with any other person;</li>
              <li>Log out of your account at the end of each session; and</li>
              <li>
                Not access the Platform from a public or shared computer without first ensuring your
                session is secure.
              </li>
            </ul>
            <p className="mt-2">
              The Firm reserves the right to suspend or terminate your account at any time for
              violation of these Terms or for any other reason at the Firm's discretion.
            </p>
          </section>

          {/* Section 4 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              4. Privacy &amp; Confidentiality
            </h3>
            <p>
              All information you submit through this Platform is treated as confidential. The Firm
              is committed to protecting your personal and legal information in accordance with its
              Privacy Policy and applicable New Jersey law.
            </p>
            <p className="mt-2">
              <strong>
                Use of this Platform does not create an attorney-client relationship until a formal
                engagement letter is signed.
              </strong>{' '}
              Upon execution of an engagement letter, all communications through this Platform are
              protected by attorney-client privilege.
            </p>
            <p className="mt-2">
              All information provided through this Platform is protected by attorney-client
              privilege upon execution of the engagement letter. The Firm will not disclose your
              information to any third party except as required by law, as permitted by you, or as
              necessary to provide legal services.
            </p>
          </section>

          {/* Section 5 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              5. Attorney-Client Relationship
            </h3>
            <p>
              <strong>
                Accessing or using this Platform, completing intake questionnaires, or submitting
                information does not, by itself, create an attorney-client relationship between you
                and Elias Counsel, LLC.
              </strong>{' '}
              An attorney-client relationship is only established upon the Firm's written acceptance
              of your matter and the execution of a mutually signed engagement letter.
            </p>
            <p className="mt-2">
              Nothing contained in this Platform constitutes legal advice. Information provided on
              this Platform is for informational and administrative purposes only and should not be
              relied upon as legal advice. For legal advice regarding your specific circumstances,
              consult with a licensed New Jersey attorney.
            </p>
            <p className="mt-2">
              Elias Counsel, LLC is licensed to practice law in the State of New Jersey. If you
              reside outside of New Jersey or your matter involves the laws of another state, the
              Firm may not be able to represent you.
            </p>
          </section>

          {/* Section 6 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              6. Limitation of Liability
            </h3>
            <p>
              TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, ELIAS COUNSEL, LLC AND ITS
              MEMBERS, EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
              SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE PLATFORM,
              INCLUDING BUT NOT LIMITED TO LOSS OF DATA, LOSS OF PROFITS, OR INTERRUPTION OF
              SERVICE.
            </p>
            <p className="mt-2">
              The Firm's total liability to you for any claims arising from the use of the Platform,
              exclusive of claims arising from legal malpractice or professional misconduct, shall
              not exceed the total fees paid by you to the Firm in the six (6) months preceding the
              claim.
            </p>
            <p className="mt-2">
              The Platform is provided on an "as is" and "as available" basis. The Firm makes no
              warranty that the Platform will be uninterrupted, error-free, or free of viruses or
              other harmful components.
            </p>
          </section>

          {/* Section 7 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              7. Data Security
            </h3>
            <p>
              The Firm employs commercially reasonable technical, administrative, and physical
              security measures to protect your information from unauthorized access, disclosure,
              alteration, or destruction. The Platform is hosted on Google Firebase / Google Cloud
              Platform, which maintains SOC 2 Type II, ISO 27001, and FedRAMP compliance
              certifications.
            </p>
            <p className="mt-2">
              All data is encrypted in transit (TLS 1.2 or higher) and at rest (AES-256). Access to
              your data is restricted to authorized Firm personnel on a need-to-know basis.
            </p>
            <p className="mt-2">
              In the event of a data breach affecting your information, the Firm will notify you in
              accordance with applicable New Jersey data breach notification law (N.J.S.A.
              56:8-163).
            </p>
          </section>

          {/* Section 8 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              8. Intellectual Property
            </h3>
            <p>
              All content on this Platform — including but not limited to software, design,
              templates, document formats, and text — is the property of Elias Counsel, LLC and is
              protected by applicable intellectual property laws. You may not copy, reproduce,
              modify, distribute, or create derivative works from any content on this Platform
              without the Firm's prior written consent.
            </p>
            <p className="mt-2">
              Documents prepared by the Firm for you pursuant to an engagement letter are your
              property and may be used for their intended legal purposes.
            </p>
          </section>

          {/* Section 9 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              9. Modifications
            </h3>
            <p>
              Elias Counsel, LLC reserves the right to modify, suspend, or discontinue the Platform
              (or any part thereof) at any time with or without notice. The Firm also reserves the
              right to amend these Terms at any time. We will provide notice of material changes by
              posting the updated Terms on the Platform and, where practicable, by email. Your
              continued use of the Platform after any modification constitutes your agreement to the
              modified Terms.
            </p>
          </section>

          {/* Section 10 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              10. Governing Law
            </h3>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the
              State of New Jersey, without regard to its conflict of law principles. Any dispute
              arising out of or relating to these Terms or the Platform shall be subject to the
              exclusive jurisdiction of the state and federal courts located in Middlesex County,
              New Jersey. You consent to personal jurisdiction in such courts.
            </p>
          </section>

          {/* Section 11 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              11. Contact Information
            </h3>
            <p>
              If you have any questions about these Terms of Service, please contact us:
            </p>
            <address className="mt-2 not-italic space-y-1 pl-4 border-l-2 border-[#2b6cb0]/30">
              <p className="font-medium text-[#1a365d]">Elias Counsel, LLC</p>
              <p>168 Prospect Plains Road</p>
              <p>Monroe Township, NJ 08831</p>
              <p>
                Phone:{' '}
                <a href="tel:+16096553200" className="text-[#2b6cb0] underline">
                  (609) 655-3200
                </a>
              </p>
              <p>
                Email:{' '}
                <a
                  href="mailto:info@adameliaslaw.com"
                  className="text-[#2b6cb0] underline"
                >
                  info@adameliaslaw.com
                </a>
              </p>
            </address>
          </section>
        </div>

        {/* Footer */}
        <footer className="mt-10 border-t border-gray-200 pt-6 text-center text-xs text-gray-400">
          <p>
            &copy; {new Date().getFullYear()} Elias Counsel, LLC. All rights reserved.
          </p>
          <p className="mt-1">
            168 Prospect Plains Road, Monroe Township, NJ 08831 &bull; (609) 655-3200
          </p>
        </footer>
      </main>

      {/* Print styles injected via style tag */}
      <style>{`
        @media print {
          @page { margin: 1in; size: letter; }
          body { font-size: 11pt; color: #000; }
          h1, h2, h3 { color: #1a365d !important; }
          a { text-decoration: none; color: #000; }
          section { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}

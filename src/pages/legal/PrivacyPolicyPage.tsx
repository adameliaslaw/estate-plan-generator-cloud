/**
 * PrivacyPolicyPage.tsx
 *
 * Static Privacy Policy page for the Elias Counsel, LLC client portal.
 * Print-friendly layout with numbered sections.
 */

import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PrivacyPolicyPage() {
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
              Privacy Policy — Client Portal
            </h2>
            <p className="mt-1 text-xs text-gray-400">Last updated: February 2026</p>
          </div>
        </header>

        {/* Intro */}
        <p className="mb-6 text-sm leading-relaxed text-gray-700">
          Elias Counsel, LLC ("Firm," "we," "our," or "us") is committed to protecting your
          privacy. This Privacy Policy explains how we collect, use, store, and protect your
          personal information when you use the Firm's Client Portal ("Platform"). By using the
          Platform, you agree to the collection and use of information as described in this Policy.
        </p>

        <div className="space-y-8 text-sm leading-relaxed text-gray-700">
          {/* Section 1 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              1. Information We Collect
            </h3>
            <p>
              We collect information you provide to us directly when you use the Platform,
              including:
            </p>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>
                <strong>Identity Information:</strong> Name, date of birth, Social Security Number
                (last four digits only), marital status, and citizenship status;
              </li>
              <li>
                <strong>Contact Information:</strong> Email address, phone number, and mailing
                address;
              </li>
              <li>
                <strong>Financial Information:</strong> Information about your assets, liabilities,
                bank accounts, investment accounts, retirement accounts, life insurance policies,
                business interests, and real estate;
              </li>
              <li>
                <strong>Family Information:</strong> Information about your spouse or domestic
                partner, children, dependents, and other beneficiaries;
              </li>
              <li>
                <strong>Healthcare Information:</strong> Your healthcare preferences, advance
                directive wishes, and organ donation preferences;
              </li>
              <li>
                <strong>Account Information:</strong> Username, password (stored in hashed form),
                and login activity; and
              </li>
              <li>
                <strong>Usage Information:</strong> How you use the Platform, including pages
                viewed, features used, and time spent on the Platform.
              </li>
            </ul>
          </section>

          {/* Section 2 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              2. How We Use Your Information
            </h3>
            <p>We use the information we collect to:</p>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>Prepare, review, and execute your estate planning documents;</li>
              <li>Communicate with you about your estate plan and legal matter;</li>
              <li>Comply with our professional obligations as attorneys;</li>
              <li>Verify your identity and prevent unauthorized access;</li>
              <li>Improve the Platform's functionality and user experience;</li>
              <li>
                Comply with applicable law, including NJ Rules of Professional Conduct; and
              </li>
              <li>
                Contact you about your matter and, with your consent, about other services the Firm
                offers.
              </li>
            </ul>
            <p className="mt-2">
              We will not use your information for marketing to third parties, nor will we sell,
              rent, or share your personal information for commercial purposes.
            </p>
          </section>

          {/* Section 3 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              3. Data Storage &amp; Security
            </h3>
            <p>
              Your information is stored on Google Firebase / Google Cloud Platform infrastructure,
              which is hosted in the United States. Google Cloud Platform maintains industry-leading
              security certifications including SOC 2 Type II, ISO 27001, and FedRAMP compliance.
            </p>
            <p className="mt-2">
              We implement the following security measures to protect your data:
            </p>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>
                <strong>Encryption in transit:</strong> All data transmitted between your browser
                and our servers is encrypted using TLS 1.2 or higher;
              </li>
              <li>
                <strong>Encryption at rest:</strong> All stored data is encrypted using AES-256
                encryption;
              </li>
              <li>
                <strong>Access controls:</strong> Access to your data is restricted to authorized
                Firm personnel on a strict need-to-know basis;
              </li>
              <li>
                <strong>Authentication:</strong> The Platform uses Firebase Authentication with
                industry-standard secure password requirements; and
              </li>
              <li>
                <strong>Session security:</strong> Sessions automatically expire after 30 minutes
                of inactivity.
              </li>
            </ul>
            <p className="mt-2">
              In the event of a data breach that may affect your personal information, we will
              notify you in accordance with N.J.S.A. 56:8-163 (New Jersey Identity Theft Prevention
              Act).
            </p>
          </section>

          {/* Section 4 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              4. Data Sharing
            </h3>
            <p>
              <strong>
                We do not sell, rent, or trade your personal information to any third party for
                commercial purposes.
              </strong>
            </p>
            <p className="mt-2">
              We may share your information only in the following limited circumstances:
            </p>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>
                <strong>As required by law:</strong> We may disclose information if required to do
                so by law, court order, or valid legal process (e.g., subpoena);
              </li>
              <li>
                <strong>Service providers:</strong> We use Google Firebase (for hosting and
                authentication), Google Cloud Platform (for data storage), and OpenAI (for AI-
                assisted document drafting). These providers are contractually bound to protect your
                data and may not use it for their own purposes;
              </li>
              <li>
                <strong>With your consent:</strong> We may share your information with third
                parties when you have given us explicit written consent to do so; and
              </li>
              <li>
                <strong>Professional obligations:</strong> As permitted under the New Jersey Rules
                of Professional Conduct, including disclosures necessary to render legal services on
                your behalf.
              </li>
            </ul>
          </section>

          {/* Section 5 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              5. Attorney-Client Privilege
            </h3>
            <p>
              Information you submit through this Platform in connection with your representation by
              Elias Counsel, LLC is subject to the attorney-client privilege under applicable New
              Jersey law (N.J.R.E. 504; N.J. Rules of Professional Conduct 1.6). Attorney-client
              communications are confidential and protected from disclosure in legal proceedings.
            </p>
            <p className="mt-2">
              <strong>
                Attorney-client privilege attaches upon execution of a formal engagement letter.
              </strong>{' '}
              Prior to execution of an engagement letter, information you submit is still treated as
              confidential but may not be protected by the privilege.
            </p>
            <p className="mt-2">
              The privilege may be waived if you disclose privileged communications to third parties
              without authorization. Do not share your login credentials or the contents of your
              portal communications with third parties.
            </p>
          </section>

          {/* Section 6 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              6. Data Retention
            </h3>
            <p>
              We retain your personal information for as long as necessary to fulfill the purposes
              outlined in this Privacy Policy and to comply with our professional and legal
              obligations. Specifically:
            </p>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>
                Client files, including all estate planning documents and communications, are
                retained for a minimum of seven (7) years following the conclusion of your legal
                matter, in accordance with New Jersey bar requirements;
              </li>
              <li>
                Original executed documents (or copies) may be retained longer where required by
                law or for the protection of your estate plan; and
              </li>
              <li>
                Account information is retained for the duration of your account and for a
                reasonable period after account closure to comply with legal obligations.
              </li>
            </ul>
          </section>

          {/* Section 7 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              7. Your Rights
            </h3>
            <p>
              Subject to applicable law and our professional obligations, you have the following
              rights with respect to your personal information:
            </p>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>
                <strong>Access:</strong> You may request a copy of the personal information we hold
                about you;
              </li>
              <li>
                <strong>Correction:</strong> You may request that we correct inaccurate information
                about you — and you may update much of your information directly through the
                Platform;
              </li>
              <li>
                <strong>Deletion:</strong> You may request that we delete your personal information,
                subject to our professional retention obligations and any applicable legal holds; and
              </li>
              <li>
                <strong>Portability:</strong> You may request a copy of your data in a commonly
                used, machine-readable format.
              </li>
            </ul>
            <p className="mt-2">
              To exercise any of these rights, please contact us at{' '}
              <a
                href="mailto:info@adameliaslaw.com"
                className="text-[#2b6cb0] underline print:no-underline"
              >
                info@adameliaslaw.com
              </a>
              . We will respond to your request within 30 days. Note that certain information may
              be exempt from deletion requests where retention is required by law or our
              professional obligations.
            </p>
          </section>

          {/* Section 8 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              8. HIPAA Considerations
            </h3>
            <p>
              Elias Counsel, LLC is a law firm and is not a "covered entity" or "business
              associate" under the Health Insurance Portability and Accountability Act (HIPAA).
              However, we recognize that healthcare and medical information submitted through this
              Platform (such as your advance directive preferences) is sensitive. We treat all such
              information with the same high level of confidentiality as attorney-client privileged
              communications and apply the same security measures described in Section 3.
            </p>
            <p className="mt-2">
              If you share protected health information (PHI) with us as part of your legal matter
              — for example, medical records relevant to a special needs trust — such information
              will be kept strictly confidential and used only to the extent necessary to provide
              legal services.
            </p>
          </section>

          {/* Section 9 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              9. Children's Privacy
            </h3>
            <p>
              This Platform is intended for adults (18 years of age and older). We do not knowingly
              collect personal information from individuals under the age of 18. If you believe we
              have inadvertently collected information from a minor, please contact us immediately
              and we will promptly delete such information.
            </p>
            <p className="mt-2">
              Information about minor children (such as your children's names and dates of birth)
              that you provide as part of your estate planning intake is collected as part of your
              matter and is governed by the same confidentiality protections that apply to your own
              information.
            </p>
          </section>

          {/* Section 10 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              10. Changes to This Policy
            </h3>
            <p>
              We may update this Privacy Policy from time to time to reflect changes in our
              practices, technology, legal requirements, or other factors. We will notify you of
              material changes by posting the updated Policy on the Platform and, where practicable,
              by email. The "Last updated" date at the top of this Policy indicates when the most
              recent changes were made. Your continued use of the Platform after changes to this
              Policy constitutes your acceptance of the revised Policy.
            </p>
          </section>

          {/* Section 11 */}
          <section>
            <h3 className="mb-2 text-base font-semibold text-[#1a365d]">
              11. Contact Us
            </h3>
            <p>
              If you have questions, concerns, or requests regarding this Privacy Policy or our
              data practices, please contact us:
            </p>
            <address className="mt-2 not-italic space-y-1 pl-4 border-l-2 border-[#2b6cb0]/30">
              <p className="font-medium text-[#1a365d]">Elias Counsel, LLC</p>
              <p>Attn: Privacy Officer</p>
              <p>168 Prospect Plains Road</p>
              <p>Monroe Township, NJ 08831</p>
              <p>
                Phone:{' '}
                <a
                  href="tel:+16096553200"
                  className="text-[#2b6cb0] underline print:no-underline"
                >
                  (609) 655-3200
                </a>
              </p>
              <p>
                Email:{' '}
                <a
                  href="mailto:info@adameliaslaw.com"
                  className="text-[#2b6cb0] underline print:no-underline"
                >
                  info@adameliaslaw.com
                </a>
              </p>
            </address>
            <p className="mt-3 text-xs text-gray-500 italic">
              This Privacy Policy is governed by the laws of the State of New Jersey, including the
              New Jersey Identity Theft Prevention Act (N.J.S.A. 56:8-163) and the New Jersey
              Consumer Fraud Act (N.J.S.A. 56:8-1 et seq.).
            </p>
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

      {/* Print styles */}
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

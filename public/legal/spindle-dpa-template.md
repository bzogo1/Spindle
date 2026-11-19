# Data Processing Addendum

**Version:** 1.0
**Effective date:** 19 November 2026
**Published at:** https://spindle.app/dpa

This template matches the published Data Processing Addendum at
https://spindle.app/dpa. Check that the version and effective date above match
the page before you sign, and send the completed document to
legal@spindle.example for a countersigned copy.

---

## 1. Parties

This Data Processing Addendum (the "DPA") forms part of the agreement between:

**Spindle Labs** ("Spindle", the "processor"), and

**Customer legal name:** ______________________________________
**Registered address:** _______________________________________
**Country of establishment:** _________________________________
**Security contact email:** __________________________________

(each a "party" and together the "parties").

It applies whenever Customer submits personal data to Spindle through the
workspace, and it prevails over any conflicting term about processing in the
underlying agreement.

## 2. Definitions

- **Personal data**, **processing**, **controller**, **processor**,
  **subprocessor**, **data subject**, and **personal data breach** have the
  meanings given in the EU General Data Protection Regulation (Regulation (EU)
  2016/679), and equivalent terms in other applicable data-protection law.
- **Services** means the Spindle workspace and the features described at
  https://spindle.app.
- **Customer data** means the personal data Customer submits to the Services.

## 3. Roles

3.1 Customer is the controller of Customer data, or a processor acting for its
own controller, in which case Spindle is a subprocessor.

3.2 Customer determines the purpose and means of processing Customer data and
is responsible for its lawful basis, for its instructions, and for the rights of
the individuals whose data appears in its workspace.

3.3 Spindle processes Customer data only on Customer's documented instructions,
including this DPA and the workspace settings Customer configures, unless a law
requires otherwise. If a law requires processing for another purpose, Spindle
tells Customer before doing so unless the law prohibits that notice.

## 4. Processing details

| Item | Detail |
| --- | --- |
| Subject matter | Providing, securing, and supporting the Spindle workspace: files, projects, labs, search, automations, agent runs, shared documents, and team chat. |
| Duration | For as long as Customer's workspace exists, followed by the return and deletion steps in clause 10. |
| Nature and purpose | Storing and organizing project content, running the features Customer uses, authenticating workspace members, keeping audit and security logs, delivering transactional email, producing diagnostics, and answering support requests. |
| Personal data | Account details (name, work email address, hashed password), workspace membership and roles, project content and metadata, usage records, diagnostics, and technical data such as IP address, browser type, and request times. |
| Data subjects | Customer's authorized users and workspace members, and any individual whose personal data appears in Customer's project content or shared documents. |
| Special categories | Spindle is a general research workspace, not a system for regulated health or biometric data. Customer should not submit special-category data unless the parties agree additional safeguards in writing first. |

Customer decides what personal data goes into a project. Spindle does not mine
project content for advertising, sell it, or use it to train models for anyone
else.

## 5. Spindle's obligations

Spindle will:

5.1 process Customer data only on Customer's documented instructions, including
when moving data between the regions and providers listed in this DPA;

5.2 keep everyone who can access Customer data under a written duty of
confidentiality, and limit access to the people who need it to run or secure the
Services;

5.3 help Customer respond to data-subject requests, and pass on a request it
receives directly unless the law says otherwise;

5.4 help Customer with data-protection impact assessments and prior
consultations, to the extent the information Spindle publishes and the technical
measures it applies are not enough;

5.5 tell Customer promptly about a legally binding request for Customer data,
unless a law or a court order forbids it, and challenge a request that is
overbroad or invalid;

5.6 not sell Customer data, not share it with data brokers, and not use it for
advertising or for automated decisions that produce legal or similarly
significant effects.

## 6. Security measures

Spindle applies the following technical and organizational measures:

- Encryption in transit with TLS, and encryption at rest for project objects
  stored in private Backblaze B2 buckets.
- No public origin: traffic reaches Spindle through Cloudflare's edge and
  outbound-only Cloudflare Tunnels.
- Workspace membership and roles checked on the server for every request, not
  only in the interface.
- Least-privilege production access, limited to the engineers who need it, with
  access logged.
- Error monitoring and session replay masked: all text and media hidden, and
  search, chat, invite, and sign-in fields blocked or masked.
- Providers reviewed before they can handle personal data, with the
  subprocessor list kept current.
- Personnel bound by confidentiality, and a review of these measures when the
  product or a provider changes.

Spindle does not claim a certification it does not hold. Write to
security@spindle.example for the current status of audits and certifications.

## 7. Subprocessors

7.1 Customer gives Spindle general written authorization to engage the
subprocessors listed at https://spindle.app/dpa#subprocessors. Each subprocessor
may process Customer data only for the purpose listed, under a written agreement
that imposes data-protection obligations at least as protective as this DPA.
Spindle remains responsible for how each subprocessor performs.

7.2 Spindle notifies Customer before a new subprocessor starts handling Customer
data. The new entry is published with its purpose, data categories, location,
and transfer mechanism, and Spindle emails the workspace owners and admins who
have subscribed to these notices. The notice period is 30 days from publication
unless a shorter period is needed to keep the Services secure or to meet a legal
requirement, in which case Spindle explains why.

7.3 Customer can object on data-protection grounds by writing to
legal@spindle.example within the notice period. Spindle will try to find another
way to provide the affected feature. If it cannot, Customer may terminate the
affected part of the Services without penalty and receive a refund of any
prepaid fee for the unused period.

7.4 Subscribe to subprocessor notices at
mailto:legal@spindle.example?subject=Subscribe%20to%20subprocessor%20notices.

## 8. Security incidents and breach notification

8.1 If Spindle becomes aware of a personal data breach affecting Customer data,
it notifies Customer without undue delay and, where feasible, within 72 hours of
becoming aware of it, to the workspace owners and the security contact named in
clause 1.

8.2 The notification describes the nature of the breach, including the
categories and approximate volume of data and data subjects affected; the likely
consequences; the measures taken or proposed; the name and contact details of
the person who can answer questions; and the steps Customer can take. Spindle
provides updates as its investigation develops.

8.3 Spindle cooperates with Customer's own notification obligations and with any
investigation. A notification is not an admission of fault, and Spindle does not
notify data subjects on Customer's behalf unless Customer asks it to.

## 9. Audit and information

9.1 Spindle answers reasonable written questions about its measures and provides
the information Customer needs to demonstrate compliance.

9.2 Customer may audit Spindle's processing once in any 12-month period, or more
often if a supervisory authority requires it, by giving at least 30 days'
written notice. Audits happen during business hours, remotely by default, and
under confidentiality. Customer covers its own costs and avoids disrupting the
Services or exposing other customers' data.

9.3 Where an independent report from a provider covers the relevant controls,
Spindle may share that instead of a separate audit of the same systems. Audit
findings are discussed in good faith, and the parties agree a remediation plan
for a confirmed material gap.

## 10. Return and deletion on termination

10.1 On termination, or on Customer's request, Spindle provides an archive of
Customer's project files and a structured file of account, workspace, and run
metadata within 30 days of a verified request.

10.2 Spindle deletes the workspace and its personal data from active storage
within 7 days of a verified request, and the data leaves encrypted backups
within 30 days.

10.3 On written request, Spindle confirms in writing that deletion is complete.
Spindle keeps only what the law requires it to keep, protected for as long as it
holds it.

## 11. International transfers

11.1 Where Customer data leaves the EEA or the United Kingdom, the parties rely
on the Standard Contractual Clauses, together with the UK Addendum where it
applies, and on each provider's security commitments. The storage location and
transfer mechanism for each provider are published at
https://spindle.app/dpa#subprocessors.

11.2 Spindle assesses a transfer before it begins and reviews it when a provider
or region changes. Write to legal@spindle.example for a copy of the safeguards
that apply to a specific provider.

## 12. Liability

12.1 Each party's liability under this DPA is subject to the limitations and
exclusions in the underlying agreement, except where applicable law does not
allow them.

12.2 Each party is responsible for its own compliance with data-protection law,
including the accuracy of the instructions it gives and the notices it provides
to data subjects.

## 13. Changes to this DPA

13.1 Spindle versions this DPA and shows the version and effective date at the
top of the published page. This template carries the same version and date.

13.2 Spindle notifies subscribed workspace admins of a material change at least
30 days before it takes effect. A change required by law or by a new
subprocessor follows clause 7.

## 14. Governing law and signatures

**Governing law:** ____________________________________________

**Jurisdiction:** _____________________________________________

Signed for and on behalf of Spindle Labs:

Name: ______________________________
Title: _______________________________
Signature: ___________________________
Date: ________________________________

Signed for and on behalf of Customer:

Name: ______________________________
Title: _______________________________
Signature: ___________________________
Date: ________________________________

Return the signed document to legal@spindle.example. Spindle returns a
countersigned copy within 5 business days and records the version that applies
to the workspace.

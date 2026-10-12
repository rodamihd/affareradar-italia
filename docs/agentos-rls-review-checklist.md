# AgentOS staging RLS review

Verified on staging: the dedicated reviewer role cannot log in, is not a superuser, and cannot bypass row-level security.

Pending: independently inspect row policies and inherited permissions, then validate access using a designated backend identity. Do not equate a SQL SELECT grant with actual row access.

No operational endpoint, secret or production configuration is authorized by this document.

Release status: BLOCKED pending a supervised staging test and an independent security review.

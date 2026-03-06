// ─── PASS 1: Fixed Fields ───

export const FIXED_QUERY =
  'contract parties provider client supplier product agreement type start date end date payment terms total amount renewal';

export const FIXED_PROMPT = `You are an expert contract analysis system. Extract ONLY the following 20 fixed fields.

FIXED FIELDS:
1. agreement_type — MSA, NDA, SOW, PO, SLA, DPA, BAA, EULA, SCHEDULE, INVOICE, ORDER, etc.
2. provider — supplier/vendor company name
3. client — customer/client company name
4. product — primary product or service
5. total_amount — "CURRENCY_CODE:AMOUNT" e.g. "USD:150000.00". Exclude taxes.
6. annual_amount — "Year 1: USD:X, Year 2: USD:Y" or calculated annual rate. "N/A" if unknown.
7. start_date — YYYY-MM-DD
8. end_date — YYYY-MM-DD
9. contract_id — contract number or reference
10. contract_classification — SAAS|IAAS|PAAS|PROFESSIONAL_SERVICES|MANAGED_SERVICES|HARDWARE|RESELLER|NETWORK|OTHER
11. contract_status — "Active" / "Inactive" / "Unknown"
12. contract_term — e.g. "24 months". Calculate from dates if not stated. "N/A" if unknown.
13. payment_terms — "X Days | Advanced" or "X Days | Arrears". Default to Arrears if timing not stated. "N/A" if absent.
14. auto_renewal — "Yes" or "No". Default "No" if unclear.
15. renewal_notice_period — "X months" only. 30d=1mo, 60d=2mo, 90d=3mo. ONLY the period to prevent auto-renewal. "N/A" if absent.
16. renewal_duration_period — "X months" only. Duration of each renewal cycle. "N/A" if auto_renewal=No.
17. relationships — comma-separated references to other documents. "N/A" if none.
18. customer_owner — client-side owner. "Name (Contact)" if available. "N/A" if not found.
19. supplier_owner — supplier-side owner. "Name (Contact)" if available. "N/A" if not found.
20. original_filename — the document filename

CONFIDENCE SCORING (weighted average, round to 2 decimals):
- OCR Quality (31%): 1.0 clear text → 0.1 severe issues
- Contradiction Check (28%): 1.0 no conflict → 0.1 major contradiction
- Inference Level (23%): 1.0 explicit → 0.1 speculative
- Expected Location (18%): 1.0 standard section → 0.1 not where expected

Return ONLY valid JSON — no markdown, no explanation:
{
  "fixed_fields": {
    "agreement_type": { "value": "...", "description": "...", "confidence": 0.0 },
    "provider": { "value": "...", "description": "...", "confidence": 0.0 },
    "client": { "value": "...", "description": "...", "confidence": 0.0 },
    "product": { "value": "...", "description": "...", "confidence": 0.0 },
    "total_amount": { "value": "...", "description": "...", "confidence": 0.0 },
    "annual_amount": { "value": "...", "description": "...", "confidence": 0.0 },
    "start_date": { "value": "...", "description": "...", "confidence": 0.0 },
    "end_date": { "value": "...", "description": "...", "confidence": 0.0 },
    "contract_id": { "value": "...", "description": "...", "confidence": 0.0 },
    "contract_classification": { "value": "...", "description": "...", "confidence": 0.0 },
    "contract_status": { "value": "...", "description": "...", "confidence": 0.0 },
    "contract_term": { "value": "...", "description": "...", "confidence": 0.0 },
    "payment_terms": { "value": "...", "description": "...", "confidence": 0.0 },
    "auto_renewal": { "value": "...", "description": "...", "confidence": 0.0 },
    "renewal_notice_period": { "value": "...", "description": "...", "confidence": 0.0 },
    "renewal_duration_period": { "value": "...", "description": "...", "confidence": 0.0 },
    "relationships": { "value": "...", "description": "...", "confidence": 0.0 },
    "customer_owner": { "value": "...", "description": "...", "confidence": 0.0 },
    "supplier_owner": { "value": "...", "description": "...", "confidence": 0.0 },
    "original_filename": { "value": "...", "description": "...", "confidence": 0.0 }
  }
}

Context from contract:
{context}`;

// ─── PASS 2: Dynamic Fields ───

export const DYNAMIC_QUERY =
  'contract clauses terms conditions liability data protection payment commercial legal use restrictions SLA confidentiality';

export const DYNAMIC_PROMPT = `You are an expert contract analysis system. Extract dynamic contract-specific clauses organized into categories. Do NOT extract the 20 fixed fields.

Categories:
- Use rights & restrictions: usage limits, geographic restrictions, feature restrictions, prohibited activities
- General: SLAs, uptime, support levels, maintenance, force majeure, business continuity. ALWAYS include "contract_description".
- Legal terms: liability cap, indemnification, confidentiality, governing law, jurisdiction, dispute resolution, IP rights
- Commercial terms: billing frequency, late fees, pricing models, cost escalation, credits, discounts
- Data protection: retention policy, data transfer, breach notification, encryption, deletion obligations

MANDATORY — always include "contract_description" in General:
- value: Purpose, scope, key obligations, deliverables, business context
- description: "Detailed contract description"

EXTRACTION RULES:
- Only extract when 95%+ confident the clause genuinely exists
- Must have significant business impact
- Must be explicitly stated — not implied or assumed
- Monetary values: always use "CURRENCY:AMOUNT" format

Return ONLY valid JSON:
{
  "dynamic_fields": {
    "Use rights & restrictions": { "field_name": { "value": "...", "description": "...", "confidence": 0.0 } },
    "General": { "contract_description": { "value": "...", "description": "Detailed contract description", "confidence": 0.0 } },
    "Legal terms": {},
    "Commercial terms": {},
    "Data protection": {}
  }
}

Context from contract:
{context}`;

// ─── PASS 3: Supplier-Specific Fields ───

export const SUPPLIER_PROMPT = `You are a contract analysis specialist for {SUPPLIER_NAME} contracts.
Extract the following supplier-specific fields. Return null for any not found.

Fields:
{SUPPLIER_FIELD_LIST}

Return ONLY valid JSON:
{
  "special_fields": {
    "{SUPPLIER_NAME}": {
      "fields": {}
    }
  }
}

Context from contract:
{context}`;

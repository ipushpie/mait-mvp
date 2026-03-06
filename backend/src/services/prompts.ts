// ─── PASS 1: Fixed Fields ───

export const FIXED_QUERY =
  'contract parties provider client supplier product agreement type start date end date payment terms total amount renewal';

export const FIXED_PROMPT = `You are an expert contract analysis system. The current date is {currentDate}. Extract ONLY the following 20 fixed fields from this contract document with brief, clear descriptions.

**CRITICAL INSTRUCTION: COMPREHENSIVE DOCUMENT ANALYSIS FOR CONFLICTS**

For each field extraction, you must:
1. **Scan the ENTIRE document** for all relevant information
2. **Identify any conflicting or contrary information** elsewhere in the document 
3. **Note exceptions, special conditions, or edge cases**
4. **Provide concise descriptions** in plain language that explain any conflicts or important context

**FIXED FIELDS TO EXTRACT:**

1. **agreement_type**: Use standardized abbreviations (MSA, NDA, SOW, PO, SLA, DPA, BAA, EULA, SCHEDULE, FURTHER AGREEMENT, INVOICE, ORDER, etc.)
2. **provider**: Service/product provider company name (the supplier/vendor)
3. **client**: Customer/client company name
4. **product**: Primary product or service being contracted
5. **total_amount**: Format as "CURRENCY_CODE:AMOUNT" (e.g., "USD:1250000.00", "EUR:808668.96"). Extract the base contract value excluding taxes, VAT, or other additional fees unless they are explicitly included as part of the core contract value.
6. **annual_amount**: Year-by-year breakdown of contract value excluding taxes, VAT, or other additional fees unless explicitly included as part of the core contract value. If explicitly mentioned in contract (e.g., "Year 1: $50,000, Year 2: $60,000"), extract as-is. If not mentioned, calculate as follows:
   - Convert contract_term from months to years (divide by 12)
   - If contract_term >= 12 months: Divide total_amount by years (e.g., 18 months = 1.5 years, so USD:150000.00 ÷ 1.5 = USD:100000.00 per year)
   - If contract_term < 12 months: Calculate proportional annual value by multiplying (e.g., 6 months with USD:50000.00 = USD:100000.00 annual rate)
   - Format examples:
     * 24 months, USD:120000.00 → "Year 1: USD:60000.00, Year 2: USD:60000.00"
     * 18 months, USD:150000.00 → "Year 1: USD:100000.00, Year 2 (6 months): USD:50000.00"
     * 6 months, USD:50000.00 → "Annual rate: USD:100000.00 (6 months actual: USD:50000.00)"
   Use "N/A" if total_amount or contract_term cannot be determined.
7. **start_date**: Contract start date in YYYY-MM-DD format
8. **end_date**: Contract expiration date in YYYY-MM-DD format
9. **contract_id**: Any unique identifier (contract number, reference number, agreement ID)
10. **contract_classification**: Use only these values: SAAS|IAAS|PAAS|PROFESSIONAL_SERVICES|MANAGED_SERVICES|HARDWARE|RESELLER|NETWORK|OTHER
11. **contract_status**: Determine current contract status ("Active" if currently in effect, "Inactive" if expired or not yet started, "Unknown" if dates are unclear or missing)
12. **contract_term**: Extract contract duration from document text (e.g., "24 months", "3 years", "36 months"). If not explicitly stated, calculate from start_date and end_date and format as months (e.g., "17 months"). Use "N/A" if cannot be determined.
13. **payment_terms**: Extract payment terms including duration and timing. Format as "X Days | Advanced" or "X Days | Arrears" (e.g., "30 Days | Advanced", "45 Days | Arrears", "Net 30 Days | Arrears"). If only duration is mentioned without timing, default to "Arrears". Use "N/A" if not specified.
14. **auto_renewal**: Whether contract automatically renews ("Yes" or "No" - must be determined from contract text, default to "No" if unclear)
15. **renewal_notice_period**: Notice period required to prevent renewal (ALWAYS format as "X months" only...)
16. **renewal_duration_period**: If the contract auto-renews, specify the duration period for each renewal cycle (ALWAYS format as "X months" only...)
17. **relationships**: Any references to other documents mentioned in this contract (comma-separated string...)
18. **customer_owner**: The person who owns the agreement on the customer/client side or should be contacted regarding the agreement from the customer organization...
19. **supplier_owner**: The person who owns the agreement on the supplier/provider side or should be contacted regarding the agreement from the supplier organization...
20. **original_filename**: The original filename of the uploaded document

**DESCRIPTION REQUIREMENTS:**
For each field, provide a brief, plain description that includes:
- Any conflicting or contrary information found elsewhere in the document
- Special conditions, edge cases, or exceptions that apply
- Important context that affects the interpretation
- Keep descriptions concise and conversational

**CONFIDENCE SCORING:**
Use a weighted scoring approach based on these four criteria:
- OCR Quality (31%): 1.0 = clear text, 0.1 = severe issues
- Contradiction Check (28%): 1.0 = no conflict found, 0.1 = major contradiction
- Inference Level (23%): 1.0 = explicitly stated, 0.1 = highly speculative
- Expected Location (18%): 1.0 = found in standard section, 0.1 = not where expected

Weighted formula: (OCR × 0.31) + (Contradiction × 0.28) + (Inference × 0.23) + (Location × 0.18)

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

Contract Text:
{context}`;

// ─── PASS 2: Dynamic Fields ───

export const DYNAMIC_QUERY =
  'contract clauses terms conditions liability data protection payment commercial legal use restrictions SLA confidentiality';

export const DYNAMIC_PROMPT = `You are an expert contract analysis system. Extract ONLY dynamic contract-specific fields from this contract document and organize them into the specified categories. Do not extract fixed fields or supplier-specific fields.

**DYNAMIC FIELDS TO EXTRACT:**

Extract EVERY relevant contract-specific field found in the document and organize them into the following categories. Perform exhaustive analysis to capture ALL contractual terms, conditions, clauses, and metadata:

**Use rights & restrictions:** Usage limitations, access restrictions, permitted uses, prohibited activities, user limitations, capacity constraints, geographic restrictions, time-based limitations, scope of use, operational boundaries, service limitations, feature restrictions, and ALL usage-related terms and constraints.

**General:** General contract terms, basic provisions, standard clauses, administrative details, general obligations, miscellaneous provisions, definitions, interpretations, general conditions, standard terms, boilerplate clauses, general requirements, service level agreements, performance metrics, uptime guarantees, response times, support levels, maintenance schedules, delivery timelines, quality standards, operational commitments, availability requirements, capacity guarantees, throughput specifications, error rates, resolution times, escalation procedures, performance penalties, technical specifications, training provisions, implementation requirements, operational constraints, system requirements, integration specifications, API limitations, bandwidth requirements, security standards, backup procedures, disaster recovery plans, insurance requirements, risk allocation clauses, force majeure provisions, business continuity requirements, security audits, penetration testing, vulnerability assessments, auto-renewal provisions, notice periods, termination rights, cancellation procedures, post-termination obligations, transition requirements, contract continuation terms, renewal pricing, termination fees, wind-down procedures, data return obligations, and ALL other general contractual provisions.

**Legal terms:** Liability limitations, indemnification clauses, confidentiality periods, data privacy compliance requirements, audit rights, regulatory compliance obligations, legal protections, governing law, jurisdiction, dispute resolution procedures, arbitration clauses, mediation requirements, legal notices, compliance certifications, regulatory reporting, intellectual property rights, warranties, representations, and ALL legal and compliance terms.

**Commercial terms:** Payment schedules, billing frequencies, late fees, currency provisions, tax responsibilities, pricing models, cost escalation clauses, financial penalties, discounts, rebates, credits, adjustments, true-up provisions, budget caps, spending limits, invoice procedures, payment methods, banking details, financial reporting requirements, audit rights, service level credits, performance bonuses, and ALL other monetary obligations and financial arrangements.

**Data protection:** Data privacy requirements, data security measures, data retention policies, data processing terms, data transfer restrictions, data subject rights, GDPR compliance, data breach notification procedures, data encryption requirements, data backup procedures, data deletion obligations, data access controls, and ALL data protection and privacy-related terms.

Use descriptive field names that clearly indicate the nature of each extracted term (e.g., "renewal_notice_period", "liability_cap", "support_response_time", "data_retention_period", "security_audit_frequency", "ip_ownership_rights"). Each dynamic field must include:
- value: Extracted value from the contract
- description: Brief explanation of what this field represents in business context
- confidence: Confidence score (0.0-1.0)

**MANDATORY DYNAMIC FIELD - Contract Description:**
Always include a "contract_description" field in the "General" category with:
- value: Comprehensive description of the contract including its purpose, scope, key obligations, deliverables, and business context...
{exclusionText}

**⚠️ CRITICAL EXTRACTION RULE: ONLY EXTRACT BUSINESS-CRITICAL CLAUSES WITH CERTAINTY**

(Full extraction rules and output format mirror the service code comments; return only the \`dynamic_fields\` JSON structure.)

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

Contract Text:
{context}`;

// ─── PASS 3: Supplier-Specific Fields ───

export const SUPPLIER_PROMPT = `You are an expert software contract analysis system designed to extract specific entitlement analysis fields from software licensing documents for {SUPPLIER_NAME}.

**CRITICAL INSTRUCTION: EXTRACT SOFTWARE ENTITLEMENT DATA**

Extract the following entitlement analysis fields with SHORT, CRISP, TO-THE-POINT values. Focus specifically on {SUPPLIER_NAME} licensing terms.

**FIELDS TO EXTRACT:**
1. Publisher
2. Reseller
3. Entitled Entity
4. Entitled Entity Country
5. Product Name
6. Purchasing — Array of all license/product line items from tables including license fees AND support/maintenance fees as SEPARATE entries
7. Total Quantity
8. Metric
9. Metric Definition
10. Term
11. Level
12. Limitations
13. Included Rights
14. CSI
15. Purchase Date
16. Governing Agreement
17. Support Contract Number
18. Support Start Date
19. Support End Date
20. Original Document Name
21. Document Type
22. License Value
23. License Value per Unit
24. Contractual Support Value
25. Support Value per Year
26. Support Value per Year per Unit
27. Currency
28. Index
29. Delta
30. Purchasing Includes Taxes

**ADDITIONAL SUPPLIER-SPECIFIC FIELDS FOR {SUPPLIER_NAME}:**
{SUPPLIER_FIELD_LIST}

**TABLE EXTRACTION RULES:**
- SCAN the entire document for licensing/purchasing tables
- EXTRACT ALL ROWS from tables (not just the first row)
- Keep license and support fees as SEPARATE entries
- DEDUPLICATE and consolidate after normalization
- UNIT PRICE CALCULATION: normalize to per-month basis
- For each field, include: value, description, confidence (0.0-1.0)

**CONFIDENCE SCORING:**
- 1.0 = explicitly stated in document
- 0.7 = clearly inferable from context
- 0.4 = partially available
- 0.1 = speculative/not found (use null for value)

Return ONLY valid JSON — no markdown, no explanation:
{
  "special_fields": {
    "{SUPPLIER_NAME}": {
      "publisher": { "value": "...", "description": "...", "confidence": 0.0 },
      "reseller": { "value": "...", "description": "...", "confidence": 0.0 },
      "entitled_entity": { "value": "...", "description": "...", "confidence": 0.0 },
      "entitled_entity_country": { "value": "...", "description": "...", "confidence": 0.0 },
      "product_name": { "value": "...", "description": "...", "confidence": 0.0 },
      "purchasing": { "value": "...", "description": "Array of all license/product line items", "confidence": 0.0 },
      "total_quantity": { "value": "...", "description": "...", "confidence": 0.0 },
      "metric": { "value": "...", "description": "...", "confidence": 0.0 },
      "metric_definition": { "value": "...", "description": "...", "confidence": 0.0 },
      "term": { "value": "...", "description": "...", "confidence": 0.0 },
      "level": { "value": "...", "description": "...", "confidence": 0.0 },
      "limitations": { "value": "...", "description": "...", "confidence": 0.0 },
      "included_rights": { "value": "...", "description": "...", "confidence": 0.0 },
      "csi": { "value": "...", "description": "...", "confidence": 0.0 },
      "purchase_date": { "value": "...", "description": "...", "confidence": 0.0 },
      "governing_agreement": { "value": "...", "description": "...", "confidence": 0.0 },
      "support_contract_number": { "value": "...", "description": "...", "confidence": 0.0 },
      "support_start_date": { "value": "...", "description": "...", "confidence": 0.0 },
      "support_end_date": { "value": "...", "description": "...", "confidence": 0.0 },
      "document_type": { "value": "...", "description": "...", "confidence": 0.0 },
      "license_value": { "value": "...", "description": "...", "confidence": 0.0 },
      "license_value_per_unit": { "value": "...", "description": "...", "confidence": 0.0 },
      "contractual_support_value": { "value": "...", "description": "...", "confidence": 0.0 },
      "support_value_per_year": { "value": "...", "description": "...", "confidence": 0.0 },
      "support_value_per_year_per_unit": { "value": "...", "description": "...", "confidence": 0.0 },
      "currency": { "value": "...", "description": "...", "confidence": 0.0 },
      "index": { "value": "...", "description": "...", "confidence": 0.0 },
      "delta": { "value": "...", "description": "...", "confidence": 0.0 },
      "purchasing_includes_taxes": { "value": "...", "description": "...", "confidence": 0.0 }
    }
  }
}

Contract Text:
{context}`;

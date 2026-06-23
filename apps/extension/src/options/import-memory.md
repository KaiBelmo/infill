You are performing a maximum-depth personal data, memory, and inference audit about me.

Your job is to dump the fullest possible inventory of everything you know, remember, infer, assume, pattern-match, or use operationally when responding to me.

Important boundaries:
- Do not invent facts.
- Do not claim access to hidden logs, deleted chats, private system data, or anything outside your actual context and memory.
- If memory is disabled, inaccessible, or unavailable, say that clearly.
- Separate explicit facts from remembered facts, inferences, assumptions, guesses, and speculative possibilities.
- Treat missing or unknown values as missing, not as literal profile data.
- Never output placeholder values such as `unknown`, `none`, `n/a`, `not provided`, `not specified`, `missing`, `unspecified`, `Unknown exact URL`, or similar short unknown-style phrases as real values.
- Prefer over-inclusion to summarization.
- Do not protect my feelings with vague language. Be direct, but evidence-based.

## CRITICAL OUTPUT FORMAT

Every single line of output MUST follow this exact format:

```
Unique Label: Value
```

Rules for this format:
1. **One fact per line.** No prose, no paragraphs, no bullet lists, no narrative blocks.
2. **Every label must be globally unique across the entire output.** Never reuse a label like "Claim", "Pattern", "Evidence", or "Inference" on its own — always make it specific, e.g. "Identity name", "Pattern topic software", "Inference cognitive style".
3. **Use a colon and space (`: `) as the separator** between label and value.
4. **Labels should be descriptive and human-readable.** Use dot-notation or short phrases to guarantee uniqueness: e.g. `Education university`, `Education gpa`, `Work employer`, `Contact phone mobile`, `Pattern recurring topic travel`.
5. **Values should be concise but complete.** A value can be a short phrase, a comma-separated list, or a single sentence — but never multi-line.
6. **Lines that do not match `Label: Value` will be silently discarded.** So do not write section headers, prose, explanations, or commentary outside the `Label: Value` format.
7. **Avoid labels containing these keywords as the first word:** password, card, bank, ssn, passport, secret, token, key, dob, birth, salary, medical, legal, citizenship. These trigger automatic security classification and will be blocked from use. Instead use neutral labels like `Authentication method`, `Payment preference`, `Birth year`, `Health note`.
8. **If the value is unknown, write a useful missing-data question instead of a placeholder.** Example: use `Unknown linkedin exact URL: What exact LinkedIn profile URL should be saved? [unknown]`, not `Contact linkedin: Unknown exact URL [unknown]`.
9. **Only use fillable labels for known fillable values.** If the exact URL, email, phone, address, or profile handle is not known, put it under an `Unknown ...` label so it can be learned later and will not be filled into web forms.
10. **Every line must include one confidence tag** in the value: `[confidence: high]`, `[confidence: medium]`, `[confidence: low]`, or `[confidence: missing]`. This is how sure you are that the value is correct, not how sensitive the data is.

To indicate the type/source of each fact, use a bracketed tag inside the value:

- `[fact]` — explicit fact I directly told you
- `[memory]` — remembered from past conversation
- `[inference]` — reasonable inference from evidence
- `[assumption]` — operating assumption you make
- `[speculation]` — speculative possibility
- `[prediction]` — cautious prediction
- `[unknown]` — important unknown

Confidence labels:

- `[confidence: high]` means directly stated, exact, and ready to save.
- `[confidence: medium]` means likely correct but based on memory, context, or inference.
- `[confidence: low]` means plausible but weak, speculative, or needs review before saving.
- `[confidence: missing]` means the value is unknown and should be learned from the user.

Example lines:
```
Identity name: Alex Chen [fact] [confidence: high]
Identity nationality: Canadian [fact] [confidence: high]
Contact email: alex.chen@example.com [fact] [confidence: high]
Contact phone mobile: +1-555-0123 [fact] [confidence: high]
Contact website personal: https://alexchen.example [fact] [confidence: high]
Contact portfolio: https://portfolio.example/alex [fact] [confidence: high]
Contact blog: https://blog.example/alex [fact] [confidence: high]
Contact linkedin: https://www.linkedin.com/in/alexchen [fact] [confidence: high]
Contact github: https://github.com/alexchen [fact] [confidence: high]
Contact other website: https://speaker.example/alex [fact] [confidence: high]
Unknown facebook exact URL: What exact Facebook profile URL should be saved? [unknown] [confidence: missing]
Address city: Toronto [fact] [confidence: high]
Address country: Canada [fact] [confidence: high]
Education university: Metro State University [fact] [confidence: high]
Education degree: Business Administration [memory] [confidence: medium]
Work employer: Acme Corp [fact] [confidence: high]
Work role: Marketing Manager [fact] [confidence: high]
Vehicle make: Toyota [fact] [confidence: high]
Vehicle model: Camry [fact] [confidence: high]
Emergency contact name: Jordan Chen [fact] [confidence: high]
Emergency contact relation: Spouse [fact] [confidence: high]
Pattern recurring topic: Travel planning [inference] [confidence: medium]
Assumption preferred language: English [assumption] [confidence: medium]
Prediction next action: Travel booking [prediction] [confidence: low]
Speculation blind spot: Long-term financial planning [speculation] [confidence: low]
Unknown primary goal: What is the one outcome I care about most this year [unknown] [confidence: missing]
```

## OUTPUT SECTIONS

Produce facts in this order, but ALL as `Label: Value` lines with no section headers or prose between them. Use the label prefix to group logically (e.g. all identity facts start with `Identity`, all education facts start with `Education`).

### Identity and Demographics
Everything you know about my name, identity, aliases, demographics, location, nationality.

### Languages and Culture
Languages I speak, cultural context, timezone, region clues.

### Education and Skills
Institutions, degrees, GPA, skills, learning history.

### Work and Career
Roles, companies, projects, ambitions, career direction.

### Tools and Platforms
Software, apps, platforms, and online services I use regularly (e.g. email provider, social media, productivity tools, operating system).

### Websites and Social Links
Include all known web presence, including personal websites, portfolios, blogs, creator pages, GitHub, GitLab, LinkedIn, Stack Overflow, Medium, YouTube, social profiles, usernames, handles, and any other public-facing websites associated with me. If a website is known, include it even if it is not a traditional social profile. Do not invent URLs, handles, or accounts. If you only know the platform or site exists but not the exact URL, handle, or username, record that as a partial fact or unknown rather than omitting it.

### Communication and Language
Languages I speak, how I write, how I phrase requests, preferred communication style.

### Interests and Hobbies
Music, media, communities, recurring topics, creative pursuits.

### Relationships
Family, friends, collaborators, romantic context.

### Health and Routines
Dietary preferences, allergies, physical activity, sleep habits, routines, medical notes (only if explicitly shared).

### Finances and Insurance
Banking context, insurance providers, financial goals, spending habits, subscriptions.

### Beliefs and Values
Ethics, worldview, philosophy, religion, politics if stated.

### Frustrations and Boundaries
What I dislike, what I'm impatient with, recurring complaints.

### Repeated Patterns
Topics I return to, problems I repeatedly ask about, what I optimize for, what I avoid, what I'm curious about. Each as its own unique `Pattern <specific>: Value [inference]` line.

### Operating Assumptions
Every assumption you make about me while responding. Each as `Assumption <specific>: Value [assumption]`.

### Inferences
Reasonable inferences about my cognitive style, work style, blind spots, contradictions, etc. Each as `Inference <specific>: Value [inference]`.

### Speculative Possibilities
Uncomfortable or unflattering but plausible interpretations. Each as `Speculation <specific>: Value [speculation]`.

### Predictions
What I'm likely to do next, ask for, accept, reject, get stuck on. Each as `Prediction <specific>: Value [prediction]`.

### Personalization Notes
How your knowledge of me affects your behavior (tone, detail level, examples, priorities). Each as `Personalization <specific>: Value [assumption]`.

### Unknowns
Important things you don't know. Each as `Unknown <category specific>: What is missing and one question that would resolve it [unknown] [confidence: missing]`.

## ACCURACY AUDIT

At the end, include one line per fact category assessing overall accuracy:

```
Audit identity accuracy: <high/medium/low> - <what supports it>, <what is missing> [confidence: high|medium|low|missing]
Audit education accuracy: <high/medium/low> - <what supports it>, <what is missing> [confidence: high|medium|low|missing]
Audit work accuracy: <high/medium/low> - <what supports it>, <what is missing> [confidence: high|medium|low|missing]
Audit inference accuracy: <high/medium/low> - <what supports it>, <what is missing> [confidence: high|medium|low|missing]
Audit speculation accuracy: <high/medium/low> - <what supports it>, <what is missing> [confidence: high|medium|low|missing]
```

## FINAL RULES

- Be exhaustive. The goal is maximum retrievable detail, not comfort, brevity, or elegance.
- Every line must be `Unique Label: Value [type tag] [confidence: high|medium|low|missing]`.
- No prose. No paragraphs. No section headers. No commentary.
- If response may be too long, end with: `Continuation marker: PART N` — then continue when I say "continue."
- Begin with an access statement as `Label: Value` lines:

```
Access sources: <what you can currently use> [fact] [confidence: high]
Access memory: <available or not> [fact] [confidence: high|medium|low|missing]
Access limitations: <what you cannot access> [fact] [confidence: high]
Access includes inference: <yes or no> [fact] [confidence: high]
```

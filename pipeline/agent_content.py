import anthropic
import json
from json_utils import parse_json

client = anthropic.Anthropic()


def write_content(topic, objectives, plan, research):
    objectives_text = "\n".join(f"- {o}" for o in objectives)

    prompt = f"""You are writing a 15-minute case-based teaching module called
"Ticker Talks" for internal medicine residents rotating through cardiology. A staff
cardiologist will present this live using slides.

Topic: {topic}

Learning objectives (use these exactly as given, refine wording only for clarity):
{objectives_text}

Clinical background to draw from:
Guideline summary: {research['guideline_summary']}
Key evidence: {'; '.join(research['key_trials_or_evidence'])}
Diagnostic criteria: {research['diagnostic_criteria']}

The case should establish: {plan['case_outline']['presentation']}
It should include these findings: {', '.join(plan['case_outline']['key_findings_to_include'])}
It should include this workup: {', '.join(plan['case_outline']['diagnostic_workup_to_include'])}

IMPORTANT — clinical coherence: if this topic has multiple clinically distinct
subtypes, mechanisms, or etiologies (for example: primary/degenerative versus
secondary/functional mitral regurgitation, ischemic versus non-ischemic
cardiomyopathy, HFrEF versus HFpEF), you MUST commit to exactly ONE specific,
internally consistent subtype for the entire case. Do not blend findings, exam
features, or mechanisms from different subtypes — a case should read the way one
real patient's presentation would, not a composite of several different diagnoses
that share a name. State which specific subtype/mechanism you chose in a new
"clinical_scenario" field so this is explicit and auditable.

Write the full module content — a realistic, de-identified, illustrative case (not a
real patient). Respond with ONLY valid JSON, no other text, in exactly this structure:
{{
  "title": "a short, engaging module title",
  "clinical_scenario": "one sentence naming the specific subtype/mechanism this case represents (e.g., 'severe primary degenerative mitral regurgitation due to posterior leaflet prolapse')",
  "learning_objectives": ["...", "..."],
  "key_metrics": [
    {{"label": "short label, e.g. Aortic Valve Area", "value": "short value, e.g. 0.8 cm2"}}
  ],
  "case_vignette": {{
    "age": "patient age as a plain number string, e.g. '78'",
    "sex": "Male or Female",
    "chief_complaint": "a short phrase (under 8 words) summarizing why the patient presented",
    "presentation": "1-2 sentence patient presentation (age, sex, chief complaint, duration)",
    "history": "relevant past medical/social history",
    "exam_findings": "relevant physical exam findings",
    "workup_results": "relevant labs/imaging/ECG findings"
  }},
  "teaching_points": [
    {{"heading": "short heading", "explanation": "1-2 sentence explanation"}}
  ],
  "discussion_questions": ["...", "..."],
  "quiz": [
    {{
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "correct_index": 0,
      "explanation": "why this answer is correct"
    }}
  ],
  "sources": ["...", "..."]
}}

Include 4-5 teaching points, 2-3 discussion questions, and 3 quiz questions (each with
exactly 4 options). For key_metrics, include 3-5 of the most important numeric
diagnostic values from the case (e.g. specific measurements, scores, or lab values
that define severity or drive management) — these will be displayed as visual
callouts, so pick the numbers a resident most needs to recognize at a glance.
"""
    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}]
    )
    return parse_json(response.content[0].text)


def revise_content(topic, objectives, previous_content, issues):
    """Takes existing content plus a list of flagged issues and asks Claude to fix
    just those problems, leaving everything else unchanged."""
    issues_text = "\n".join(f"- {issue}" for issue in issues)

    prompt = f"""You previously wrote this cardiology teaching module on {topic}:

{json.dumps(previous_content, indent=2)}

A reviewer flagged these specific problems:
{issues_text}

Revise the content to fix EXACTLY these issues. Do not change anything else that
wasn't flagged — keep the same structure, tone, and any parts that were already
correct. Respond with ONLY valid JSON, no other text, in the same structure as the
original content (title, clinical_scenario, learning_objectives, key_metrics,
case_vignette, teaching_points, discussion_questions, quiz, sources).
"""
    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}]
    )
    return parse_json(response.content[0].text)


if __name__ == "__main__":
    import json
    from agent_planner import plan_module
    from agent_researcher import research_topic
    objectives = ["Recognize severe AS on exam", "Interpret echo severity criteria", "Know when to refer for intervention"]
    plan = plan_module("Aortic Stenosis", objectives)
    research = research_topic("Aortic Stenosis", plan)
    content = write_content("Aortic Stenosis", objectives, plan, research)
    print(json.dumps(content, indent=2))
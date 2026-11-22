import anthropic
from json_utils import parse_json

client = anthropic.Anthropic()


def plan_module(topic, objectives):
    objectives_text = "\n".join(f"- {o}" for o in objectives)

    prompt = f"""You are an instructional designer for an Internal Medicine residency
program, planning a 15-minute case-based teaching module called "Ticker Talks" for
residents rotating through cardiology.

Topic: {topic}

The program director has specified these learning objectives — the module MUST be
built to support exactly these, not different ones:
{objectives_text}

Create a structural plan for the case and teaching content that will help residents
achieve these specific objectives. Respond with ONLY valid JSON, no other text, in
exactly this structure:
{{
  "case_outline": {{
    "presentation": "brief description of what the case vignette should establish (patient demographic, chief complaint)",
    "key_findings_to_include": ["...", "..."],
    "diagnostic_workup_to_include": ["...", "..."]
  }},
  "teaching_points": ["...", "...", "...", "..."],
  "quiz_topics": ["...", "...", "..."]
}}

Include 4-5 teaching points and 3 quiz topics, each one clearly tied back to one of
the objectives above.
"""
    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}]
    )
    return parse_json(response.content[0].text)


if __name__ == "__main__":
    import json
    plan = plan_module(
        "Aortic Stenosis",
        ["Recognize severe AS on exam", "Interpret echo severity criteria", "Know when to refer for intervention"]
    )
    print(json.dumps(plan, indent=2))
import anthropic
import json
from json_utils import parse_json

client = anthropic.Anthropic()


def review_content(topic, objectives, content):
    objectives_text = "\n".join(f"- {o}" for o in objectives)

    prompt = f"""You are reviewing a cardiology teaching module for internal medicine
residents before it goes to a staff physician for final sign-off. Check it carefully
for problems a careful editor would catch.

Topic: {topic}

Required learning objectives:
{objectives_text}

Module content (JSON):
{json.dumps(content, indent=2)}

Check specifically for:
1. Does every quiz question's correct_index actually match its own explanation?
2. Are all 4 options for each quiz question plausible and non-overlapping (no two
   options that could both be defended as correct)?
3. Does the case vignette's presentation, history, exam, and workup actually support
   the stated learning objectives?
4. Is anything internally contradictory (e.g. numbers in the case don't match numbers
   referenced in teaching points or quiz questions)?
5. Is the content appropriately scoped for a 15-minute teaching session (not
   overloaded with tangential detail)?

Respond with ONLY valid JSON, no other text, in exactly this structure:
{{
  "approved": true or false,
  "issues": ["specific issue description", "..."]
}}

If there are no real problems, return approved: true with an empty issues list. Do
not invent issues to seem thorough — only flag genuine problems.
"""
    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}]
    )
    return parse_json(response.content[0].text)


if __name__ == "__main__":
    import json
    from agent_planner import plan_module
    from agent_researcher import research_topic
    from agent_content import write_content

    objectives = ["Recognize severe AS on exam", "Interpret echo severity criteria", "Know when to refer for intervention"]
    plan = plan_module("Aortic Stenosis", objectives)
    research = research_topic("Aortic Stenosis", plan)
    content = write_content("Aortic Stenosis", objectives, plan, research)
    review = review_content("Aortic Stenosis", objectives, content)
    print(json.dumps(review, indent=2))
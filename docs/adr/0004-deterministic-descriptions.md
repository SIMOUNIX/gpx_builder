# Descriptions are generated deterministically

Stage and trip descriptions are built by the app from the trip's facts (stops by km along the stage, water tiers, treatment line, daily summary), so the model can never invent a fact. The model may only add one optional line, the planner note. Descriptions go to the GPX `<desc>` and `<metadata><desc>`.

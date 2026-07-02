
# Creating a work item
- When adding a repo the filepath option should be a folder select prompt and should have autocomplete if you wanted to type it out
  - this should also handle windows \ vs / pathing
  - it should flag an issue inline if the repo does not have a git folder (though not block)
- It is also possible to have the remote URL inferred by the existance of the .git folder? I am not sure where that information actually lives
- It would be create if the review section was richly displayed as markdown (though this can be deferred until everything is working)

# Creating a workflow
Creating a workflow from scratch is very time consuming and a bit cumbersome.
- when creating a template there should be a way to use some predefined templates that are just built into the system. For us lets focus on a separate vue and dotnet workflow
  - when someone clicks +new workflow they should be asked if they want to use a template or not (blank should be blank)
- when defining the model to use for a persona, it should have text autocomplete for the available models, but still allow typing something else incase models have changed recently

# Actual runs
- the activity panel is simply too long and unimportant to be useful in its existing form
  - it is important that we record all this information, but it is not needed all the time
  - instead show the last 5 messages as a "chain of thought" style where you can expand for tool information on click if you want to
  - move "view all activity" to a button that opens a separate/filterable searchable page
- When I am asked for approval, there is now display of what I am actually meant to be approving.
  - For example, in the review phase for my initial spec, I was not shown what the spec had become so there was no way I could actually review it
  - All artifacts that need review should be displayed here somehow 
- There is no way to terminate a run while it is active (at least I did not find anything)

# Activity nav item
- Active agents always appear blank even though my own tool perch (../../perch) could see the session was running

# It should work without sprig
Because sprig is still in active development, I think there should be an option to run this directly on the main repo, maybe just asking for the branch it should work on. This will allow me to see the quality it creates before having to also wire in sprig and ensure it is working correctly.



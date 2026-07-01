# Objective
To create an agent orchestrator and workflow desktop application where the eventual goal is that you never *really* have to leave the application.

# How it should be used
I really want the ability to 
- define the work to be done (the spec + repos involved)
- define a workflow that defines *how* work needs to be done over a set of stages
  - this can include the types of agents that need to review it
  - what criteria needs to pass for it to be considered ready to go
  - literal human intervention gates that need to be passed before proceeding to the next step
- hit run and watch it go through the steps

## Example 1
For a basic feature I might want the following workflow

- stage 1 - review Spec
  - define a *persona* for a technical lead, product owner and UX Designer that all analyse the ticket and report back their findings
    - when feedback is given it should not change the spec automatically, instead it should offer a way to request changes be made from within the app
  - only go to the next stage after the following
    - personas agree there are no more changes needed
    - a human approves the changes
- stage 2 - create a plan
  - define a "persona" for an architect that reviews the spec to create a phased implementation plan
  - once created a human is asked to review
  - a human approves the implemntation plan
    - if there seems to be an issue with the spec, move back to the first stage
- stage 3 - setup
  - relevant infrastructure and worktrees are created for the impacted repositories
- stage 4 - implementation loop
  - agents (with profiles defined by the user) are tasked with implementing phase X (this process is iterative so it will likely not be a one shot)
  - once done, changes are commited to the phase branch (off of the main feature branch in the worktree)
  - a reviewer agent then verifies if it looks ok (again, another configurable persona)
    - if it isnt, go back to the first agent and  
  - a human reviewer is then asked to check the phase as done
- stage 5 - feature verification
  - here we use the feature end to end and record any issues found and run any other automated tests (including more verifying agents)
  - if there are any issues, we go back to the first phase with knowledge of what needs to be fixed
  - if everything is good, a human then determines how the change gets to main/master
    - can be either opening a PR or merging directly to master

Though the example is a bit long winded, the key points are
- take a SPEC from start to finished, iterating small chunks along the way
- there should be a audit/history log of EVERYTHING meaningful that happens along the way.
  - spec definition changes, agents being spawned and their outcomes, review by other agents and humans, timestamped data of when work was being done and when it moved between stages
- Workflows should not be static. A user should be able to define their process and it be followed in a predictable way. ie if you want agile, you should get agile


# Technical requirements
- Because I want a rich, long running process, I think that using electron is probably going to be the best bet. I know that it is heavy, but if I want to use rich interactions an leverage work done by others, it seems like the best fit. My only other option is avalonia but I think it will be awkward for rich UI.
- MCP, tool usage and skills should be BYO. I do not want to assume someone works a certain way. Instead they can work the way they want (everyone is different)
- I really want to make worktrees and isolated infrastructure the best way to work, so docker and docker compose are going to be a requirement
  - This is so that you can spin up multiple different features at once and just let them go without stepping on eachothers foot
- I would like to have some kind of versioning mechanism so that I can see how the spec changes over time + some kind of workflow audit history so I can see the transaction of EVERYTHING that happened. We could consider something like sqlite to track the changes
- because we are looking to use subagents, it is important to understand when context pressure arises as it can mean that output quality is going to decline
  - when this happens, we need to make it visually clear to see who is doing what and why at any given moment for a specific workflow. If context pressure is high, some kind of in app warning should be shown to go an correct it
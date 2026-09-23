You are the specification author for the request below. A less capable engineer will implement it afterwards, working only from what you write. They follow written requirements literally and do not fill in intent that is not written down, so whatever you leave out will be missing from the result. Do not implement the request yourself.

Write two things in this repository:

1. `SPEC.md`: the complete specification.
   - State everything a user of the finished work would expect, including what the request leaves unsaid because it is obvious to a person. Ask yourself what would make the result technically correct and still disappointing, and rule each of those out with a numbered requirement.
   - Fix the file layout, the public names, signatures, starting values and units, so that your tests and their implementation cannot disagree.
   - Give concrete values wherever a vague word would do (speeds, sizes, limits, timings, keys), and say how the parts behave over time, not only at one step.
   - Keep the parts that need a terminal, network or clock separate from the logic, so the logic can be tested without them.
2. Acceptance tests that check the numbered requirements through the public interface defined in `SPEC.md`. They must fail now, pass for a correct implementation, and run under the acceptance command given below. Include tests of behaviour over many steps from the real starting state, not only of single steps from hand-made states. Refer to the requirement number in each test name or docstring. Read each test again against `SPEC.md` before you finish: the implementer is not allowed to change these files, so a wrong test cannot be repaired.

Write no implementation code, not even stubs. In your final answer list the files you wrote and the requirements you added beyond the literal request.

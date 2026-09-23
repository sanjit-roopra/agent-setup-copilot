Build a simple Pong game in Python in this empty repository. Use only the Python 3 standard library: no pygame, no pytest, no pip installs.

Layout:

- `pong/__init__.py`
- `pong/game.py`: the game rules, with no input, output, timing or `curses` import. A `Game` class (or equivalent) holds the court size, two paddles, the ball and the score, and advances by one `step()`. Everything in it must be testable without a terminal.
- `pong/__main__.py`: a `curses` front end, so `python3 -m pong` plays the game in a terminal. Left paddle `w`/`s`, right paddle arrow up/down, `q` quits. It only reads keys, calls `pong.game` and draws.
- `tests/test_game.py`: `unittest` tests for `pong/game.py`.
- `README.md`: how to run the game and the tests.

Rules the tests must cover:

1. The ball moves by its velocity on every step.
2. The ball bounces off the top and bottom walls and never leaves the court vertically.
3. The ball bounces off a paddle when it reaches that paddle's column within the paddle's height.
4. When the ball passes a paddle, the opposite player scores one point and the ball is served again from the centre, towards the player who just scored against.
5. Paddles move up and down by one step and cannot leave the court.
6. The first player to reach 5 points wins; after that `step()` changes nothing.

Finish only when this passes from the repository root:

    python3 -m unittest discover -s tests -q && python3 -m py_compile pong/*.py

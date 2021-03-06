/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

if (sessionStorage.resizeByX) {
  window.resizeBy(
    parseInt(sessionStorage.resizeByX, 10),
    parseInt(sessionStorage.resizeByY, 10));
}

navigator.id.raiseAuthenticationFailure();


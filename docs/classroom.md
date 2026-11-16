# Classroom

Classroom is a teacher-led screen-sharing feature in the desktop app. In Multi-device mode,
admission and WebRTC signaling use the existing authenticated Zantexa Link peer connection rather
than a separate LAN web server. It is separate from Mesh's trusted-device pairing: the teacher
still approves every student before sharing.

## App-to-app classroom (Multi-device)

1. Turn on **Multi-device** on the teacher and student Windows, Mac, or Linux computers.
2. Pair and connect each student computer to the teacher in **Multi-device**. A class appears only
   on computers that are directly connected to the teacher; indirect Mesh roster entries cannot
   join a class.
3. On the teacher computer, open **Classroom** and choose **Start class**. Share the temporary code
   with students.
4. On each student computer, open **Classroom**, find the teacher's active class, enter the code and
   a name, then choose **Request to join**.
5. Accept or decline each request on the teacher computer. Choose a display and start sharing.
   Accepted students see the stream in a separate window. The teacher can remove a student or end
   the room.

Mesh supports up to 10 devices total, including the teacher, so up to 9 direct student links can
join at once. Each receives an individual direct WebRTC video stream. Screen audio is not shared.
The same paired desktop apps must be connected at the same time; a browser cannot join this mode.

While screen sharing is active, the teacher can choose one or more files to send to every approved
student currently in the class. Students choose which files to save. Each file is limited to 100 MB;
students cannot send files back to the teacher.

Mesh connections are direct, not cloud-relayed. The apps do not have to share the same Wi-Fi if
their existing Mesh connection has a usable direct network path (for example, reachable addresses
over a VPN). However, screen video needs an IP network path between the computers; a Bluetooth-only
connection cannot carry the video. Firewalls, NAT, or network isolation can prevent a direct path.
Classroom does not add Internet signaling, STUN, or TURN infrastructure.

## Same-network classroom (standard one-to-one mode)

When Multi-device is off, the existing LAN mode remains available:

1. Connect the teacher and students to the same Wi-Fi or hotspot.
2. Start a room from **Classroom** and share its join address and six-digit code.
3. Students open the address in a current browser or in the desktop app.
4. Approve requests and start screen sharing as above.

This LAN mode supports up to 30 requests, subject to network and computer performance. Its local
HTTP page and room code are not encrypted in transit, so use it only on a trusted network.
Teacher-shared files use the same direct WebRTC connection as the screen and are limited to 100 MB
each. Only currently approved students receive them, and each student chooses whether to save.

The Android app provides **Classroom** under **More** for students. Enter the teacher's displayed
private-network address, room code, and your name; the app opens the classroom page in a browser,
where the teacher can approve the request and share the screen and files. Android does not host
teacher classrooms.

## Privacy

In Multi-device mode, room requests and signaling travel over the authenticated Zantexa Link
connection. Screen video and shared files are encrypted by WebRTC. No account or cloud service is
used. Pair only devices you trust and stop the class when finished.

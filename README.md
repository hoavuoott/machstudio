# Mạch Studio

Web chỉnh nhạc tĩnh. HTDemucs tách vocal, trống, bass và nhạc cụ còn lại ngay trong trình duyệt. Bài nhạc được chọn từ ổ đĩa và xử lý trên thiết bị.

## Mở bản thử

Chạy `node preview.mjs` trong thư mục dự án, rồi mở `http://127.0.0.1:4178`. Chrome hoặc Edge trên máy tính là điểm khởi đầu để thử WebGPU. Dùng MP3 hoặc WAV.

Chọn bài, bấm **Tách bằng AI**, rồi đồng ý tải mô hình khoảng 175 MB. Trình duyệt lưu mô hình vào Cache Storage của trang khi còn đủ chỗ. Nếu bạn có sẵn bản ONNX tương thích với Demucs.js, dùng **Chọn file ONNX**. Nút **Xóa mô hình đã lưu** giải phóng vùng lưu trữ của web và bỏ lựa chọn mô hình trong phiên hiện tại.

Timeline có waveform, tua, chỉnh âm lượng/pan/EQ, mute/solo, preset, giữ hoặc bỏ một đoạn, đảo ngược và xuất WAV. Tốc độ thay đổi cả cao độ. Bản thử chưa có sửa cao độ tự động, khử ồn hoặc chỉnh tốc độ giữ tông. Tách AI luôn lấy file đầu vào ban đầu và mở kết quả thành bốn track mới.

## GitHub Pages

Đặt nội dung thư mục này ở gốc repo GitHub. Trong **Settings → Pages**, chọn **Deploy from a branch**, chọn nhánh chứa mã và thư mục gốc. Giữ nguyên thư mục `vendor` cùng `.nojekyll`. Trang tải mô hình từ bản phát hành tĩnh của Demucs.js khi người dùng đồng ý, nên repo không cần chứa mô hình 175 MB. Mục **Chọn file ONNX** vẫn dùng được nếu nguồn tải không truy cập được.

Bản thử dùng mô hình HTDemucs ONNX do [Demucs.js](https://github.com/bakkot/demucs-js) cung cấp. Xem giấy phép trong `vendor`. Giải pháp này dành cho sử dụng cá nhân và nghiên cứu theo điều khoản được dự án nguồn công bố cho mô hình.

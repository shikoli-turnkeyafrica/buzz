import 'package:flutter_test/flutter_test.dart';
import 'package:buzz/brand.dart' as brand;
import 'package:buzz/features/channels/photo_library.dart';

void main() {
  group('PhotoLibraryAccessException', () {
    test('names the app in its message', () {
      expect(
        const PhotoLibraryAccessException().toString(),
        contains(brand.productName),
      );
    });
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../brand.dart' as brand;
import 'cybota_mark.dart';

/// The Cybota mark; one tap spins the arcs a full turn.
///
/// When reduced motion is enabled, the mark stays static.
class TappableCybotaMark extends HookConsumerWidget {
  final double size;
  final Color color;

  const TappableCybotaMark({
    required this.size,
    required this.color,
    super.key,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final animation = useAnimationController(
      duration: const Duration(milliseconds: 900),
    );
    final reducedMotion = MediaQuery.disableAnimationsOf(context);

    void spin() {
      if (reducedMotion) return;
      animation.forward(from: 0);
    }

    return Semantics(
      button: true,
      label: '${brand.vendor} mark',
      hint: 'Tap to spin it',
      onTap: spin,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        excludeFromSemantics: true,
        onTap: spin,
        child: AnimatedBuilder(
          animation: animation,
          builder: (context, _) => CybotaMark(
            size: size,
            color: color,
            spin: Curves.easeInOutCubic.transform(animation.value),
          ),
        ),
      ),
    );
  }
}

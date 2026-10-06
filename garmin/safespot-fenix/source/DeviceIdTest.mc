import Toybox.Lang;
import Toybox.Test;

(:test)
function deviceIdHasExpectedFormat(logger as Logger) as Boolean {
    var id = DeviceId.generate();
    if (id.length() != 17 || !id.substring(0, 3).equals("SS-")) {
        logger.debug("bad shape: " + id);
        return false;
    }
    var chars = id.toCharArray();
    for (var i = 3; i < 17; i++) {
        var isDash = (i == 7 || i == 12);
        if (isDash != (chars[i] == '-')) {
            logger.debug("dash misplaced: " + id);
            return false;
        }
        if (!isDash && DeviceId.ALPHABET.find(chars[i].toString()) == null) {
            logger.debug("bad character: " + id);
            return false;
        }
    }
    return true;
}

(:test)
function deviceIdsAreRandom(logger as Logger) as Boolean {
    return !DeviceId.generate().equals(DeviceId.generate());
}

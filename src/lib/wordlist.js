/* 1024 short, common, unambiguous English words for passphrases: exactly 10 bits per word.
   Lowercase a–z only, unique (tests/password.test.mjs checks both). */
export const WORDS = `
acorn actor adobe agent alarm album alley amber anchor angle ankle answer anvil apple apron arcade arch arena armor
arrow artist ashes aspen atlas atom attic auburn autumn avocado award axis bacon badge bagel baker bakery balcony
ballad ballet bamboo banana bandit banjo banner barley barn barrel basil basin basket baton bayou beach beacon beagle
beam bean bear beaver bedrock beech beetle bell bench berry bicycle bison blanket blaze blender blimp blossom blue
blueprint board boat bobcat bonfire bonnet book boot border bottle boulder bowl bracket branch brass bread breeze
brick bridge brook broom bubble bucket buckle budget buffalo bugle bundle burrow butter button cabin cable cactus
cake camel camera camp canal candle candy canoe canyon captain caramel card cargo carpet carrot cart castle cedar
cellar cello chalk channel chapel chart cheese cherry chess chestnut chime chimney chisel chorus cider cinema circle
circus citrus city clam clay cliff clock cloud clover coach coast cobalt cocoa coconut comet compass concert copper
coral cork corn cotton cougar county cove coyote crab cradle crane crater crayon creek cricket crown crystal cube
cupcake curtain cushion cyclone cypress dagger daisy dancer dawn deck delta denim desert desk dessert diamond diary
dinner dock dolphin domain donkey door dragon drawer dream drift drum dune eagle easel echo eclipse elbow elm ember
emerald engine envoy falcon fable fabric fan farm feather fence fern ferry festival fiddle field fig filter finch
fire fjord flag flame flannel flask fleet flint flood flower flute foam focus fog forest forge fossil fountain fox
frame freckle frost fruit galaxy gallery garden garlic gate gazebo gecko gem geyser giant ginger giraffe glacier
glass globe glove goat gold goose gorilla grain granite grape graph grass gravel gravy griddle grove guitar gull
gumbo habit hammer hammock harbor harp harvest hawk hazel heart hedge helmet hermit heron hill hive hobby honey hook
horizon horse hotel house husky hydrant igloo index ink island ivory ivy jacket jaguar jam jar jasmine jelly jersey
jetty jewel jigsaw jockey journal judge juice jungle kayak kernel kettle key kiosk kite kitten kiwi knight knot koala
ladder lagoon lake lamp lantern laptop larch lark lasso latch lava lawn leaf ledge lemon lens leopard letter lever
library lilac lily lime linen lion lizard llama lobster locket lodge loft lotus lumber lunar lynx magnet mango maple
marble market marsh mason meadow melon mesa meteor metro mill mint mirror mitten moat model monsoon moon moose mortar
mosaic moss motor mountain muffin mural museum mustard napkin nectar needle nest nickel noodle north notch novel
nugget nutmeg oak oasis ocean olive onion opal orbit orchard orchid organ otter oven owl oyster paddle pagoda palace
palm pancake panda paper parade parcel parrot pasta pastry path peach peanut pear pebble pecan pelican pencil penguin
pepper piano pickle picnic pier pillow pilot pine pioneer pirate pistachio pixel planet plank plaza plum pocket poem
polar pond poodle poplar poppy porch potato pottery prairie prism pudding puffin pumpkin puppet puzzle pyramid quail
quarry quartz quill quilt rabbit raccoon radar radio radish raft rain raisin ranch raven reef relay ribbon rice ridge
river road robin rocket rodeo roof rose rover ruby rudder saddle saffron sail salmon salt sandal sapphire satin
saucer savanna scarf school scooter scroll season seed shadow shark shell shelter ship shore shovel shrimp signal
silk silver siren skate sketch sky sled slipper sloth smoke snail snow soap socket sofa solar sonnet soup spade
sparrow spider spinach spiral sponge spoon spring spruce squash squid squirrel stable stadium stamp star statue steam
stone storm stove straw stream street sugar summit sun sunset swamp swan sweater syrup table taco tadpole tailor
talon tango tavern teapot temple tennis tent thimble thistle thunder ticket tiger timber toast token tomato topaz
torch tortoise tower tractor trail train trellis trophy trout truck trumpet tulip tundra tunnel turkey turtle tuxedo
twig umbrella unicorn valley vapor vase velvet violet violin volcano voyage waffle wagon walnut walrus wand wave
weasel whale wheat wheel whistle willow window winter wizard wolf wombat wool yacht yarn yogurt zebra zenith zipper
able agile alert amused ample ancient angry arctic azure bold brave breezy brief bright brisk broad bumpy busy calm
candid cheerful chilly civic clean clever cloudy cozy crisp curly dapper daring dainty dazzling deep dense dizzy
dusty eager early earnest easy elegant epic even exact fancy fast fearless fierce fluffy foggy fond frosty fresh
friendly frozen funny fuzzy gentle giddy glad gleaming glossy golden graceful grand grassy great green happy hardy
hasty hearty heavy hidden hollow honest humble hungry icy ideal idle jolly jovial joyful keen kind lanky large lavish
lazy legal lively lofty loud loyal lucky lush magic major mellow merry mighty mild misty modern modest muddy murky
narrow neat nimble noble nutty odd olden open orange oval patient peaceful perky plain playful plucky polite proud
purple quick quiet rapid rare ready regal rich rigid ripe rocky rosy rough round royal rustic rusty sandy savvy
scenic shiny short silent silly simple sleek sleepy slim smart smooth snowy snug soft solid sonic sour spare speedy
spicy spry steady steep sticky stormy sturdy sunny super sweet swift tall tame tangy tender thick tidy tiny tough
tranquil tricky trusty upbeat urban vast vivid warm wavy wild windy wise witty woolly young zany zesty adapt admire
aim arrive bake balance bargain bask blend bloom borrow bounce brew build buzz carry carve catch charm chase cheer
chop clap climb collect cook count crawl create cruise dance dash debate deliver design dig dive doodle draft drive
enjoy explore fetch find fix float fly fold forage gallop gather giggle glide glow grow guard guide hike hop hover
hum hunt imagine invent jog juggle jump keep kick knit laugh launch lead learn lift listen march mend mix nap
navigate nudge organize paint pause pedal pitch plant play plow polish ponder pour pull race read relax repair rescue
rest ride roam roar row run scoot search sew shine sing skip sleep slide smile snack solve sort spin sprint stack
steer stir stroll surf swim swing teach think toss travel tumble twirl unpack vote wade walk wander wash watch weave
whisk win wink wish write yawn yodel zoom anthem apricot avenue bakers banquet beehive biscuit blizzard bramble`.trim().split(/\s+/);
